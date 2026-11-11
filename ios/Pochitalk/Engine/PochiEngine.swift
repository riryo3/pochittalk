import AVFAudio
import Combine
import Foundation
import Network
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import AVFoundation
#endif
import WebRTC

/// アプリ全体の状態とふるまい。Web 版 (worker.js) のクライアントコードに対応する (Android 版 PochiEngine.kt の移植):
/// ロビー(部屋一覧)、部屋への入退室、ボタンを押して話す、話中ロック、混線、VOX、効果音。
///
/// 内部状態はすべて RT.queue (直列キュー) 上で触る。UI からの呼び出しは各 public 関数が RT.post でそこへ移す。
/// UI へは [ui] / [meter] (Published) で伝える。
final class PochiEngine: ObservableObject {
    static let shared = PochiEngine()

    // ---- Web 版と共通のプロトコル定数。変えると Web 版・Android 版と通話できなくなる
    static let appId = "pochitalk-v2" // 0.25.4 の通信形式は 0.20.0 と互換が無いので、識別名も新しくしている (Web 版と同じ)
    static let maxRoom = 99 // 1つの部屋の人数の上限 (Web 版の MAX_ROOM と同じ値。実質、制限なし)
    private static let actionPttState = "pttState"
    private static let actionPttName = "pttName"
    private static let actionFaxPage = "faxPage" // {c, d}: FAX の絵 (列数と、白黒のビット列の base64)
    private static let actionRoomTag = "roomTag" // {tag, by, at}。話題タグ。新しい(at が大きい)ほうが勝つ
    private static let actionJoinAge = "joinAge" // 入室してからの経過時間を交換し、新しく来た側を判定する
    private static let tagMax = 30
    static let inviteBaseUrl = "https://pochittalk.ryota-softwares.workers.dev/"

    private static let streamId = "pochitalk-audio"
    private static let voxHoldMs = 1500
    /// 送信を続けるかの判定は、開始のしきい値より低くして (ヒステリシス)、語尾や言葉の間で切れないようにする。
    private static let voxHoldRatio: Float = 0.6
    private static let voxCooldownMs = 700
    private static let lobbyStaleMs = 20_000 // 在室通知がこれだけ途絶えたら、一覧から消す (Web 版 PRESENCE_EXPIRE_MS)
    private static let presenceBeatMs = 6_000
    private static let mismatchNotifyMs = 10_000
    private static let mismatchReconnectMs = 25_000
    private static let autoReconnectGapMs = 90_000
    private static let defaultVoxStep = 4

    // ---- UI に見せる状態
    @Published private(set) var ui = UiState()
    @Published private(set) var meter = MeterState()
    /// 画面に出すログ (診断用。最新の数十行)
    @Published private(set) var diagLines: [String] = []

    // ---- RT.queue 専用の状態
    private var st = UiState()
    private let defaults = UserDefaults.standard
    private let device = PochiAudioDevice()
    private lazy var sounds = RadioSounds(device: device)
    private var factory: RTCPeerConnectionFactory?
    private var net: TrysteroNetwork?
    private var audioSource: RTCAudioSource?
    private var audioTrack: RTCAudioTrack?
    private let turn = TurnClient(endpoint: URL(string: inviteBaseUrl + "api/turn")!)
    private var presence: PresenceClient?
    private var presenceUrls: [String] = Array(RelayList.nostrRelayUrls.prefix(4))
    private var presAnnounced = false
    private var presLastSent = 0
    private var presPending: Job?
    private var mismatchSince = 0
    private var mismatchNoted = false
    private var lastAutoReconnect = 0
    /// 自動で再接続するか (設定。標準はオフ)。オフでも、手動の「再接続」と、マイクの取り直し、音声セッションの復帰は動く。
    private var autoReconnect = false

    private struct LobbyEntry { var key: String; var talking: Bool; var name: String; var ts: Int; var tag: String; var tagBy: String; var tagAt: Int; var op: Int }
    private var lobbyEntries: [String: LobbyEntry] = [:]

    private var room: TrysteroRoom?
    private var pttStateAction: TrysteroRoom.Action?
    private var pttNameAction: TrysteroRoom.Action?
    private var roomTagAction: TrysteroRoom.Action?
    private let morseRx = MorseDecoder()
    private let faxRx = FaxReceiver()
    private var toneJob: Job?
    private final class PeerState {
        var name: String; var talking: Bool; var joinJudged = false; var enteredAt = 0
        init(name: String, talking: Bool) { self.name = name; self.talking = talking }
    }
    private var peers: [(id: String, state: PeerState)] = []
    private func peer(_ id: String) -> PeerState? { peers.first { $0.id == id }?.state }

    private var myNickname = ""
    /// 名前の表示: 通信の記録をとっている間は、前に 💾 を付けて、同じ部屋の人にも見えるようにする
    private var shownName: String { (st.logRec ? "💾" : "") + myNickname }
    private var launchMs = 0
    private var roomChimeAt: [String: Int] = [:]
    private var currentKey: String?
    private var pendingKey: String?
    private var roomMeta = (tag: "", by: "", at: 0)
    private var reconnecting = false
    private var reconnectWatchdog: Job?
    private var hiddenAt = 0
    private var micTest = false
    private var roomEnterTime = 0
    /// 部屋を開いた時刻 (エポック ms。0=不明)。一覧で見えている値と自分の値の、いちばん早いもの。
    private var roomOpenAt = 0
    private var currentTalkerId: String?
    private var isTransmitting = false
    private var pressed = false
    private var flashJob: Job?
    private var crosstalkJob: Job?

    // VOX
    private var voxJob: Job?
    private var voxHits = 0
    private var voxLastVoice = 0
    private var voxCooldownUntil = 0
    private var voxInitiated = false

    // レベルメーター (Web 版の draw() と同じ: 平滑化 + ピークホールド)
    private var meterLevel: Float = 0
    private var meterPeak: Float = 0
    private var meterPeakHoldUntil = 0
    private var rxLevel = 0.0
    private var rxPolledAt = 0
    private var rxPolling = false
    private var uiActive = true
    private var pathMonitor: NWPathMonitor?
    private var lastPathSignature = ""
    private var pathDebounce: Job?

    private init() {}

    // ================================================================ 起動

    func start() {
        RT.post { [self] in
            guard factory == nil else { return }
            let nick = defaults.string(forKey: "pochitalk_ptt_name") ?? "無線機_\(100 + Int.random(in: 0..<899))"
            myNickname = nick
            st.nickname = nick
            st.voxSens = min(10, max(1, defaults.object(forKey: "pochitalk_vox_level") as? Int ?? Self.defaultVoxStep))
            st.voxThreshold = voxMeterFraction(voxThreshold())
            let gainDb = min(30, max(0, defaults.integer(forKey: "pochitalk_input_db")))
            st.micGainDb = gainDb
            device.gain = Float(pow(10.0, Double(gainDb) / 20))
            st.welcomeOn = defaults.string(forKey: "pochitalk_welcome") != "off"
            st.notifyRoom = defaults.string(forKey: "pochitalk_notify_room") == "on"
            st.logRec = defaults.string(forKey: "pochitalk_log_rec") == "on"
            launchMs = RT.nowMs()
            if st.logRec { logBuffer = defaults.stringArray(forKey: "pochitalk_diag_log") ?? [] }
            let sfx = min(150, max(0, defaults.object(forKey: "pochitalk_sfx_vol") as? Int ?? 100))
            st.sfxVolume = sfx
            sounds.volume = Float(sfx) / 100
            st.lefty = defaults.string(forKey: "pochitalk_lefty") == "1"
            st.pttPos = PttPosition(rawValue: defaults.string(forKey: "pochitalk_ptt_pos") ?? "") ?? .center
            st.micPermission = currentMicPermission()
            autoReconnect = defaults.bool(forKey: "pochitalk_auto_reconnect")
            st.autoReconnect = autoReconnect
            device.onStateChange = { [weak self] running, note in
                RT.post {
                    guard let self else { return }
                    self.st.audioRunning = running
                    self.diag("音声ユニット: \(note) (\(self.device.diagnostics))")
                    self.commit()
                }
            }
            commit()
            registerNetworkWatcher()
            startNetwork()
        }
    }

    private func startNetwork() {
        factory = RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device)
        // TURN の資格情報は /api/turn から短命のものを受け取る (鍵は端末に持たない)。取れなければ STUN だけ
        turn.refresh(force: true) { [self] in
            RelayList.pick { [self] roomRelays, presenceRelays in
                RT.log("relays: room=\(roomRelays) presence=\(presenceRelays) turn=\(turn.hasTurn)")
                diag("リレー \(roomRelays.count) 本 / TURN \(turn.hasTurn ? "あり" : "なし")")
                makeNetwork(roomRelays, presenceRelays)
                st.ready = true
                renderScan()
                startTimers()
            }
        }
    }

    private func makeNetwork(_ roomRelays: [String], _ presenceRelays: [String]) {
        guard let f = factory else { return }
        let n = TrysteroNetwork(factory: f, iceServers: { [turn] in turn.iceServers }, relayUrls: roomRelays)
        net = n
        presenceUrls = presenceRelays
        n.start()
        startPresence()
    }

    private func startTimers() {
        RT.every(50) { [self] in meterTick() }
        RT.every(Self.presenceBeatMs) { [self] in
            let now = RT.nowMs()
            lobbyEntries = lobbyEntries.filter { now - $0.value.ts <= Self.lobbyStaleMs }
            announce()
            renderScan()
        }
        RT.every(3_000) { [self] in commit(); checkMismatch() } // 「接続 N / 在室 M」も3秒ごとに更新
        RT.every(5_000) { [self] in checkRoomFull() }
        RT.every(5 * 60_000) { [self] in turn.refresh {} } // 10分以内に取れていれば何もしない
    }

    // ================================================================ 状態の反映

    private func commit() {
        refreshCounts()
        let s = st
        DispatchQueue.main.async { if self.ui != s { self.ui = s } }
    }

    /// 「接続 N / 在室 M」: N = 実際につながっている人数 + 自分、M = 在室の一覧の人数 (N 未満にはしない)。
    private func refreshCounts() {
        guard let cur = currentKey, room != nil else { st.connN = 0; st.connM = 0; st.missingNames = []; return }
        let n = peers.count + 1
        let listed = lobbyEntries.values.filter { $0.key == cur }.count + 1
        st.connN = n; st.connM = max(n, listed)
        st.connAudio = (room?.goodLinkCount() ?? 0) + 1 // 音声が通っている人数 (自分を含む)
        // 未接続: 一覧にはいるのに、まだつながっていない人
        st.missingNames = Self.missingNames(listed: lobbyEntries.values.filter { $0.key == cur }.map { $0.name },
                                            connected: peers.map { $0.state.name })
    }

    /// 新しい部屋ができたら、音だけで知らせる (画面の知らせや OS の通知は出さない)。
    /// 条件: 設定オン / 効果音オン / 起動から 12 秒より後 / いまの部屋でも、おうむの部屋でもない / 同じ部屋は 10 分に 1 回まで。
    private func chimeNewRoom(_ key: String) {
        guard st.notifyRoom, sounds.volume > 0, RT.nowMs() - launchMs > 12_000,
              key != currentKey, !isBotRoom(key) else { return }
        let now = RT.nowMs()
        if let last = roomChimeAt[key], now - last < 600_000 { return }
        roomChimeAt[key] = now
        sounds.playNewRoom()
    }

    func setNotifyRoom(_ on: Bool) {
        RT.post { [self] in
            st.notifyRoom = on
            if on { defaults.set("on", forKey: "pochitalk_notify_room"); sounds.playNewRoom() } // 確かめに 1 回鳴らす
            else { defaults.removeObject(forKey: "pochitalk_notify_room") }
            commit()
        }
    }

    /// 通信の記録を、この端末に残す (最大 300 行)。オフにしたら消す。外部へは送らない。
    func setLogRec(_ on: Bool) {
        RT.post { [self] in
            st.logRec = on
            if on { defaults.set("on", forKey: "pochitalk_log_rec"); defaults.set(logBuffer, forKey: "pochitalk_diag_log") }
            else { defaults.removeObject(forKey: "pochitalk_log_rec"); defaults.removeObject(forKey: "pochitalk_diag_log") }
            pttNameAction?.sendString(shownName) // 名前が変わるので、相手にも知らせる
            announce()
            renderScan()
            commit()
        }
    }

    private var logBuffer: [String] = []

    /// 一覧の名前から、つながっている相手の名前を (先頭 12 文字、個数で) 引いた残り。名前がまだ届いていない相手 (接続中...) の数だけは、残りから外す。
    static func missingNames(listed: [String], connected: [String]) -> [String] {
        var left = listed.map { String($0.prefix(12)) }
        var unnamed = 0
        for n in connected {
            if n == "接続中..." { unnamed += 1; continue }
            if let i = left.firstIndex(of: String(n.prefix(12))) { left.remove(at: i) }
        }
        return Array(left.dropFirst(min(unnamed, left.count)))
    }

    func clearDiagLines() { DispatchQueue.main.async { self.diagLines = [] } }

    private func diag(_ line: String) {
        if st.logRec {
            RT.post { [self] in
                logBuffer = Array((logBuffer + ["\(DateFormatter.localizedString(from: Date(), dateStyle: .short, timeStyle: .medium)) \(line)"]).suffix(300))
                defaults.set(logBuffer, forKey: "pochitalk_diag_log")
            }
        }
        RT.log(line)
        let t = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        DispatchQueue.main.async { self.diagLines = Array((self.diagLines + ["\(t) \(line)"]).suffix(400)) }
    }

    // ================================================================ 権限

    private func currentMicPermission() -> MicPermission {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return .granted
            case .denied: return .denied
            default: return .undetermined
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
        #else
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        default: return .undetermined
        }
        #endif
    }

    private var micGranted: Bool { currentMicPermission() == .granted }

    /// マイクの許可をたずねる (まだたずねていないときだけ、システムのダイアログが出る)。
    func requestMic(then: (() -> Void)? = nil) {
        let finish: (Bool) -> Void = { [self] granted in
            RT.post {
                st.micPermission = granted ? .granted : .denied
                if granted {
                    if room != nil || micTest { device.setKeepRunning(true) }
                    ensureMic()
                } else {
                    flash("マイクが許可されていません。設定アプリで許可してください")
                }
                commit()
                then?()
            }
        }
        #if os(iOS)
        if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission(completionHandler: finish) }
        else { AVAudioSession.sharedInstance().requestRecordPermission(finish) }
        #else
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: finish)
        #endif
    }

    // ================================================================ ロビー (部屋一覧)

    private func startPresence() {
        presence?.close()
        let pc = PresenceClient(urls: presenceUrls) { [weak self] pubkey, d in self?.onPresence(pubkey, d) }
        presence = pc
        pc.start()
    }

    private func int(_ v: Any?) -> Int { (v as? NSNumber)?.intValue ?? 0 }

    #if DEBUG
    /// 開発用: 一覧にだけいる人 (在室通知だけ来て、つながらない人) を作る。
    func debugFakePresence(_ key: String, _ name: String) {
        RT.post { [self] in
            onPresence("fake-pubkey-\(name)", ["ch": key, "name": name, "talking": false])
            diag("fake presence: lobby=\(lobbyEntries.count) missing=\(st.missingNames)")
        }
    }
    #endif

    /// op (部屋を開いた時刻) の検査: 1.6e12 より大きく、現在時刻+10分以下だけ採用。
    static func validOp(_ v: Any?) -> Int {
        let n: Double
        if let i = v as? Int { n = Double(i) } else if let d = v as? Double { n = d } else { return 0 }
        return (n > 1.6e12 && n <= Double(RT.nowMs()) + 600_000) ? Int(n) : 0
    }

    private func onPresence(_ pubkey: String, _ d: [String: Any]) {
        let ch = ((d["ch"] as? String) ?? "").lowercased()
        if ch.isEmpty {
            if lobbyEntries.removeValue(forKey: pubkey) != nil { renderScan() }
            return
        }
        guard isRoomKey(ch) else { return }
        let isNew = lobbyEntries[pubkey] == nil
        let roomWasKnown = lobbyEntries.values.contains { $0.key == ch }
        lobbyEntries[pubkey] = LobbyEntry(
            key: ch, talking: (d["talking"] as? Bool) ?? false, name: String(((d["name"] as? String) ?? "?").prefix(12)),
            ts: RT.nowMs(), tag: capTag(d["tag"] as? String), tagBy: String(((d["by"] as? String) ?? "").prefix(12)), tagAt: int(d["at"]), op: Self.validOp(d["op"]))
        if !roomWasKnown { chimeNewRoom(ch) }
        if isNew {
            // 新しく来た人に、こちらの在室をすぐ知らせる (Web 版の announceSoon)
            RT.after(300 + Int.random(in: 0..<1200)) { [self] in announce() }
        }
        renderScan()
    }

    /// いまどの部屋にいるかを知らせる (Web 版の announce)。続けて呼ばれても1秒に1回にまとめる。
    /// 部屋にいないときは何も送らない (出たときだけ、1回「いない」と送る)。
    private func announce() {
        guard let p = presence else { return }
        let gap = RT.nowMs() - presLastSent
        if gap < 1000 {
            if presPending == nil {
                presPending = RT.after(1000 - gap) { [self] in presPending = nil; announce() }
            }
            return
        }
        guard let key = currentKey else {
            if !presAnnounced { return }
            presAnnounced = false
            presLastSent = RT.nowMs()
            p.publish(["ch": ""])
            return
        }
        presAnnounced = true
        presLastSent = RT.nowMs()
        p.publish(["ch": key, "cn": room?.goodLinkCount() ?? 0, "ag": max(0, (RT.nowMs() - roomEnterTime) / 1000), "talking": isTransmitting, "name": shownName, "tag": roomMeta.tag, "by": roomMeta.by, "at": roomMeta.at, "op": roomOpenAt])
    }

    private func renderScan() {
        RT.log("scan: lobby=\(lobbyEntries.count) presence=\(presence != nil) net=\(net != nil)")
        struct Stat { var op = 0; var count = 0; var air = false; var names: [String] = []; var tag = ""; var tagBy = ""; var tagAt = 0 }
        var stats: [String: Stat] = [:]
        for e in lobbyEntries.values {
            var s = stats[e.key] ?? Stat()
            s.count += 1
            s.names.append(e.name)
            if e.op > 0 { s.op = s.op == 0 ? e.op : min(s.op, e.op) }
            if e.talking { s.air = true }
            if e.tagAt > s.tagAt { s.tagAt = e.tagAt; s.tag = e.tag; s.tagBy = e.tagBy } // 部屋のタグは、いちばん新しいものを採用する
            stats[e.key] = s
        }
        let cur = currentKey
        if let cur {
            var s = stats[cur] ?? Stat()
            s.count += 1
            s.names.insert(shownName + "(自分)", at: 0)
            if isTransmitting { s.air = true }
            if roomOpenAt > 0 { roomOpenAt = s.op > 0 ? min(roomOpenAt, s.op) : roomOpenAt }
            s.op = roomOpenAt
            if roomMeta.at > s.tagAt { s.tagAt = roomMeta.at; s.tag = roomMeta.tag; s.tagBy = roomMeta.by }
            stats[cur] = s
        }
        let pend = pendingKey
        if let pend, stats[pend] == nil { stats[pend] = Stat() }
        // おうむ返しの部屋は、無人でも、いつも一覧に出す (指定がなければ、ここに合わせる)
        if stats[botRoomKey] == nil { stats[botRoomKey] = Stat() }
        st.totalPeople = stats.values.reduce(0) { $0 + $1.count }
        // ハッシュ順。ボットの部屋は先頭、招待された部屋はさらにその前 (Web 版と同じ)
        var order = stats.keys.sorted()
        // 先頭は新しいおうむの部屋、次に旧いおうむの部屋 (人がいるときだけ。stats に載っているときだけ)
        order = [botRoomKey] + (stats[botRoomOld] != nil ? [botRoomOld] : []) + order.filter { !isBotRoom($0) }
        if let pend { order = [pend] + order.filter { $0 != pend } }
        st.rooms = order.map { k in
            let s = stats[k]!
            return RoomInfo(key: k, count: s.count, air: s.air, names: s.names, invited: k == pend && s.count == 0,
                            isCurrent: k == cur, tag: s.tag, tagBy: s.tagBy, openAt: s.count > 0 ? s.op : 0)
        }
        st.pendingKey = pend
        commit()
    }

    // ================================================================ 入退室

    func createRoom() {
        RT.post { [self] in
            var bytes = [UInt8](repeating: 0, count: 4)
            _ = SecRandomCopyBytes(kSecRandomDefault, 4, &bytes)
            joinInternal(bytes.map { String(format: "%02x", $0) }.joined())
            flash("新しい部屋を作りました。招待で友達を呼べます")
        }
    }

    func join(_ key: String) { RT.post { [self] in joinInternal(key) } }

    private func joinInternal(_ key: String) {
        guard let n = net else { return flash("接続の準備中です。少し待ってください") }
        guard isRoomKey(key) else { return }
        if isTransmitting { return flash("送信中は部屋を変えられません") }
        if key == currentKey { return flash("すでにこの部屋です") }
        // 満員の部屋には入れない (一覧の人数が上限のとき)
        if lobbyEntries.values.filter({ $0.key == key }).count >= Self.maxRoom { return flash("この部屋は満員です（\(Self.maxRoom)人まで）") }
        if currentMicPermission() == .undetermined { requestMic() }
        leaveInternal(keepAudio: true)
        persistNickname()
        currentKey = key
        pendingKey = nil
        micTest = false
        st.micTest = false
        stopVoxInternal() // Web 版と同じく、入室すると VOX はオフに戻る
        roomEnterTime = RT.nowMs()
        roomOpenAt = lobbyEntries.values.filter { $0.key == key && $0.op > 0 }.map(\.op).min() ?? RT.nowMs()
        roomMeta = ("", "", 0)
        st.roomTag = ""; st.roomTagBy = ""

        connectRoom(n, key)
        enterAudioSession()
        resetStatus()
        st.currentKey = key
        st.pendingKey = nil
        renderPeers()
        announce()
        renderScan()
    }

    /// 通話部屋に接続して、アクションを配線する。入室と再接続で共用する。
    private func connectRoom(_ n: TrysteroNetwork, _ key: String) {
        let r = n.joinRoom(appId: Self.appId, roomId: "h-\(key)")
        room = r
        let stateAction = r.action(Self.actionPttState)
        let nameAction = r.action(Self.actionPttName)
        let joinAgeAction = r.action(Self.actionJoinAge)
        let tagAction = r.action(Self.actionRoomTag)
        pttStateAction = stateAction; pttNameAction = nameAction; roomTagAction = tagAction
        startToneDecoding()
        // FAX: 中身はデータ便で届く (表示は、音のピーに合わせて1行ずつ)
        let faxAction = r.action(Self.actionFaxPage)
        faxPageAction = faxAction
        faxAction.onMessage = { [self] msg, peerId in
            if msg.isJson { faxRx.onPage(peerId: peerId, json: msg.json()) }
        }

        nameAction.onMessage = { [self] msg, peerId in
            if let p = peer(peerId) { p.name = String(msg.text.prefix(24)); renderPeers(); renderScan() }
        }
        stateAction.onMessage = { [self] msg, peerId in
            if msg.isJson { onPttState(peerId, (msg.json()["isTalking"] as? Bool) ?? false) }
        }
        // 新しく来た人を判定して、すでに部屋にいる側だけ入室音を鳴らす (Web 版と同じ仕組み)
        joinAgeAction.onMessage = { [self] msg, peerId in
            guard let p = peer(peerId), msg.isJson else { return }
            let age = (msg.json()["age"] as? NSNumber)?.intValue ?? -1
            if age >= 0 {
                p.enteredAt = RT.nowMs() - age
                RT.after(500) { [self] in checkRoomFull() }
                if !p.joinJudged {
                    p.joinJudged = true
                    let myAge = RT.nowMs() - roomEnterTime
                    if age < myAge - 1000 { sounds.playEnter() } // 相手のほうが新しい = 相手が今入ってきた
                }
            }
        }
        // 話題タグ: 新しい(at が大きい)ほうを採用する
        tagAction.onMessage = { [self] msg, _ in
            guard msg.isJson else { return }
            let d = msg.json()
            let at = int(d["at"])
            if at > roomMeta.at {
                roomMeta = (capTag(d["tag"] as? String), String(((d["by"] as? String) ?? "").prefix(12)), at)
                publishMeta()
            }
        }
        r.onPeerJoin = { [self] peerId in
            diag("相手とつながった: \(peerId.prefix(5))")
            peers.removeAll { $0.id == peerId }
            peers.append((peerId, PeerState(name: "接続中...", talking: false)))
            renderPeers()
            RT.after(3_000) { [self] in checkRoomFull() }
            nameAction.sendString(shownName, to: peerId)
            if roomMeta.at > 0 { tagAction.sendJson(metaJson(), to: peerId) } // 後から来た人にも、いまのタグを伝える
            let ageAtJoin = RT.nowMs() - roomEnterTime
            joinAgeAction.sendJson(["age": ageAtJoin], to: peerId)
            // 相手が経過時間を送ってこない場合 (別の実装など): 自分が20秒以上いるなら、相手は新規とみなす
            RT.after(2_500) { [self] in
                if let p = peer(peerId), !p.joinJudged {
                    p.joinJudged = true
                    if ageAtJoin > 20_000 { sounds.playEnter() }
                }
            }
        }
        r.onPeerLeave = { [self] peerId in
            diag("相手が抜けた: \(peerId.prefix(5))")
            peers.removeAll { $0.id == peerId }
            if currentTalkerId == peerId { onStopReceiving() }
            renderPeers()
        }
        // 入室でも再接続でも、新しい部屋にマイクの音声トラックを付ける (これが無いと、話しても相手に音声が届かない)
        ensureMic()
    }

    func leave() { RT.post { [self] in leaveInternal(keepAudio: false) } }

    private func leaveInternal(keepAudio: Bool) {
        if room == nil && currentKey == nil { return }
        if isTransmitting { pressed = false; stopTransmission() }
        room?.leave()
        room = nil
        pttStateAction = nil; pttNameAction = nil; roomTagAction = nil; faxPageAction = nil
        faxMode = false; faxText = ""; faxProbe = ""; st.faxCompose = nil
        stopToneDecoding()
        roomMeta = ("", "", 0)
        peers.removeAll()
        currentTalkerId = nil
        currentKey = nil
        roomOpenAt = 0
        stopVoxInternal()
        crosstalkJob?.cancel()
        if !keepAudio { exitAudioSession() }
        resetStatus()
        st.currentKey = nil; st.peers = []; st.roomTag = ""; st.roomTagBy = ""
        announce() // 出たことを1回だけ知らせる
        renderScan()
    }

    // ================================================================ 満員・つながり不一致の監視

    /// 同時に入って上限を超えたとき、入室が新しい人から、上限を超えた分が自分で退出する (古い人は追い出されない)。
    private func checkRoomFull() {
        guard currentKey != nil, room != nil, peers.count + 1 > Self.maxRoom else { return }
        var members: [(String, Int)] = [("me", roomEnterTime)]
        for p in peers { members.append((p.id, p.state.enteredAt)) }
        members.sort { $0.1 != $1.1 ? $0.1 < $1.1 : $0.0 < $1.0 }
        guard let rank = members.firstIndex(where: { $0.0 == "me" }), rank >= Self.maxRoom else { return }
        leaveInternal(keepAudio: false)
        flash("この部屋は満員のため、退出しました（\(Self.maxRoom)人まで）")
    }

    /// 在室通知 (リレー経由) と、通話の接続 (WebRTC) は別のしくみ。10秒以上ずれたら画面に知らせ、
    /// 25秒以上ずれたら自動でつなぎ直す (つなぎ直しは90秒に1回まで)。
    private func checkMismatch() {
        guard let cur = currentKey, room != nil else { mismatchSince = 0; mismatchNoted = false; return }
        let expected = lobbyEntries.values.filter { $0.key == cur }.count
        let connected = peers.count
        if expected <= connected { mismatchSince = 0; mismatchNoted = false; return }
        let now = RT.nowMs()
        if mismatchSince == 0 { mismatchSince = now }
        let dur = now - mismatchSince
        if dur > Self.mismatchNotifyMs && !mismatchNoted {
            mismatchNoted = true
            flash("ほかに \(expected - connected) 人が在室していますが、まだつながっていません" + (autoReconnect ? "（つなぎ直しています）" : "。「再接続」を押すと、やり直せます"))
        }
        if autoReconnect && dur > Self.mismatchReconnectMs && now - lastAutoReconnect > Self.autoReconnectGapMs && !reconnecting {
            lastAutoReconnect = now
            mismatchSince = now
            mismatchNoted = false
            reconnectInternal(auto: true)
        }
    }

    /// 招待リンクで開かれた。自動では入室せず、一覧に「招待」として出す。
    func setPendingKey(_ key: String?) {
        RT.post { [self] in
            pendingKey = isRoomKey(key) ? key : nil
            renderScan()
        }
    }

    /// 招待 URL (Web 版と同じ形)。
    func inviteUrl(for key: String?) -> String? { key.map { Self.inviteBaseUrl + "?r=" + $0 } }

    /// URL (https://…/?r=xxxxxxxx または pochitalk://…?r=xxxxxxxx) から部屋のキーを取り出す。
    static func roomKey(from url: URL) -> String? {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let r = items.first(where: { $0.name == "r" })?.value, isRoomKey(r.lowercased()) { return r.lowercased() }
        let last = url.lastPathComponent.lowercased()
        return isRoomKey(last) ? last : nil
    }

    // ================================================================ 話題タグ

    /// 制御文字を除いて30文字までにする (Web 版の capTag と同じ)。
    private func capTag(_ t: String?) -> String {
        var out = String.UnicodeScalarView()
        var n = 0
        for u in (t ?? "").unicodeScalars where u.value >= 32 && u.value != 127 {
            out.append(u)
            n += 1
            if n >= Self.tagMax { break }
        }
        return String(out).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func metaJson() -> [String: Any] { ["tag": roomMeta.tag, "by": roomMeta.by, "at": roomMeta.at] }

    private func publishMeta() {
        st.roomTag = roomMeta.tag; st.roomTagBy = roomMeta.by
        announce()
        renderScan()
    }

    /// 部屋の話題タグをつける/変える (誰でも変えられ、付けた人の名前が添えられる)。空にすると消える。
    func setTag(_ text: String) {
        RT.post { [self] in
            guard let key = currentKey, !isBotRoom(key) else { return } // ボットの部屋は、タグを変えられない
            let t = capTag(text)
            roomMeta = (t, t.isEmpty ? "" : shownName, RT.nowMs())
            roomTagAction?.sendJson(metaJson())
            publishMeta()
        }
    }

    // ================================================================ 再接続

    /// 通話とロビーの接続を張り直す。部屋には入ったまま (入室時刻・タグ・マイクはそのまま)。
    /// 相手が見つからない、声が届かなくなったとき、回線が切り替わったときに使う。
    func reconnect(auto: Bool = false) { RT.post { [self] in reconnectInternal(auto: auto) } }

    private func reconnectInternal(auto: Bool) {
        RT.log("reconnect requested (auto=\(auto), already=\(reconnecting))")
        guard !reconnecting, let n = net else { return }
        reconnecting = true
        st.reconnecting = true
        commit()
        // 見張り: 40秒たっても終わらなければ、止まったとみなして、ボタンを押せるように戻す
        reconnectWatchdog?.cancel()
        reconnectWatchdog = RT.after(40_000) { [self] in
            guard reconnecting else { return }
            RT.log("reconnect: watchdog fired")
            reconnecting = false
            st.reconnecting = false
            flash("再接続に時間がかかっています。もう一度「再接続」を押してください")
        }
        let key = currentKey
        flash(auto ? "接続が切れた可能性があるので、つなぎ直しています…" : "再接続中…")
        if key != nil {
            if isTransmitting { pressed = false; stopTransmission() }
            // 古い接続を片付ける (マイクと、部屋に入っている状態はそのまま)
            room?.leave()
            room = nil
            pttStateAction = nil; pttNameAction = nil; roomTagAction = nil
            peers.removeAll()
            currentTalkerId = nil
            st.ledRx = false
            renderPeers()
        }
        presence?.close()
        presence = nil
        lobbyEntries.removeAll()
        renderScan()
        RT.after(400) { [self] in // 古い部屋の後始末 (leave) が終わるのを待つ
            RT.log("reconnect: closing old network")
            n.close()
            // 資格情報を取り直し、動いているリレーを選び直してから、つなぎ直す (Web 版の reconnectRoom と同じ)
            turn.refresh(force: true) { [self] in
                RT.log("reconnect: turn refreshed (turn=\(turn.hasTurn))")
                RelayList.pick { [self] roomRelays, presenceRelays in
                    RT.log("reconnect: relays picked \(roomRelays.count)")
                    makeNetwork(roomRelays, presenceRelays)
                    if let key, currentKey == key, let n2 = net { // 待っている間に退出・移動していなければ、部屋につなぎ直す
                        connectRoom(n2, key)
                        renderPeers()
                        announce()
                    }
                    renderScan()
                    reconnectWatchdog?.cancel()
                    reconnecting = false
                    st.reconnecting = false
                    flash("再接続しました。相手が見つかるまで少し待ってください")
                }
            }
        }
    }

    /// 回線が戻った/切り替わったときに、自動でつなぎ直す (Web 版の online イベントに相当)。
    /// 実機では、起動直後などに「回線の細かい変化」(使える経路の増減) が何度も通知される。
    /// それで再接続すると、入室したばかりの部屋から抜けてしまうので、次のときだけにする:
    ///  - 使っている回線の種類 (Wi-Fi / モバイル / 有線) が変わった、または、いったん切れて戻った
    ///  - その状態が3秒続いた (ばたつきをならす)
    ///  - 起動して20秒以上たっている
    private func registerNetworkWatcher() {
        let m = NWPathMonitor()
        pathMonitor = m
        let started = RT.nowMs()
        m.pathUpdateHandler = { [weak self] path in
            let sig: String = {
                guard path.status == .satisfied else { return "none" }
                if path.usesInterfaceType(.wifi) { return "wifi" }
                if path.usesInterfaceType(.wiredEthernet) { return "wired" }
                if path.usesInterfaceType(.cellular) { return "cellular" }
                return "other"
            }()
            RT.post {
                guard let self else { return }
                let old = self.lastPathSignature
                RT.log("path: \(old) -> \(sig) status=\(path.status)")
                self.lastPathSignature = sig
                self.pathDebounce?.cancel()
                // 最初の通知、回線が無い状態、変化なしは、何もしない
                guard !old.isEmpty, sig != old, sig != "none" else { return }
                self.refreshLobby(reason: "network \(old) -> \(sig)") // 一覧は、すぐ取り直す (通話の再接続は、下で、3秒続いたとき)
                self.pathDebounce = RT.after(3_000) { [weak self] in
                    guard let self, self.autoReconnect, self.lastPathSignature == sig, RT.nowMs() - started > 20_000 else { return }
                    RT.log("network changed \(old) -> \(sig)")
                    self.reconnectInternal(auto: true)
                }
            }
        }
        m.start(queue: DispatchQueue(label: "app.pochitalk.path"))
    }

    /// 部屋一覧 (在室の知らせ) を取り直す: 購読のやり直し、死んだ接続の張り直し、自分の在室をすぐ知らせる、一覧の描き直し。
    /// 前面に戻ったとき、回線が戻ったときに呼ぶ (iPhone は裏で接続が止まりやすい)。入室中でもホームでも効く。
    /// 通話の接続 (WebRTC) は壊さず、リレーとの WebSocket だけを見直す。
    func refreshLobby(reason: String) {
        RT.post { [self] in
            guard !reconnecting else { return } // 再接続の最中は、そちらが作り直す
            RT.log("refresh lobby (\(reason))")
            presence?.refresh()
            net?.refreshRelays()
            presLastSent = 0 // 1秒のまとめを飛ばして、すぐ知らせる
            RT.after(600) { [self] in // 接続が開くのを少し待ってから、在室を知らせる
                presLastSent = 0
                announce()
                renderScan()
            }
            renderScan()
        }
    }

    /// アプリが裏に回った/戻った。ロック中も通話は続く (音声セッションを保持している) ので、裏に回っただけでは何もしない。
    /// 長く離れて戻ったときに、相手とつながっていなければ自動でつなぎ直す。
    func onAppBackground() {
        RT.post { [self] in hiddenAt = RT.nowMs(); uiActive = false }
    }

    func onAppForeground() {
        RT.post { [self] in
            uiActive = true
            st.micPermission = currentMicPermission()
            commit()
            refreshLobby(reason: "foreground")
            let since = hiddenAt
            hiddenAt = 0
            if since == 0 || RT.nowMs() - since < 20_000 { return }
            if autoReconnect && peers.isEmpty { reconnectInternal(auto: true) }
        }
    }

    // ================================================================ ニックネーム

    func setNickname(_ text: String) {
        RT.post { [self] in
            st.nickname = text
            myNickname = text.trimmingCharacters(in: .whitespaces).isEmpty ? "NoName" : text.trimmingCharacters(in: .whitespaces)
            commit()
        }
    }

    /// 入力が終わったときに保存して、部屋の仲間に知らせる。
    func commitNickname() {
        RT.post { [self] in
            persistNickname()
            pttNameAction?.sendString(shownName)
            announce()
            renderScan()
        }
    }

    private func persistNickname() {
        let t = st.nickname.trimmingCharacters(in: .whitespaces)
        myNickname = t.isEmpty ? "NoName" : t
        defaults.set(myNickname, forKey: "pochitalk_ptt_name")
    }

    // ================================================================ マイクと音声セッション

    private func ensureMic() {
        if let t = audioTrack {
            room?.addLocalTrack(t, streamId: Self.streamId)
            return
        }
        guard let f = factory else { return }
        // 音声の取り込み自体は PochiAudioDevice がやる。ここで作るのは、相手へ送る「口」としてのトラックだけ。
        // トラックは有効のままにして、送るかどうかは device.transmitting で決める (マイクは止めない)。
        let source = f.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let track = f.audioTrack(with: source, trackId: "pochitalk-mic")
        track.isEnabled = true
        audioSource = source
        audioTrack = track
        room?.addLocalTrack(track, streamId: Self.streamId)
    }

    /// 部屋にいる間、音声セッションを保持してマイクを回し続ける (ロック中の VOX の土台)。
    private func enterAudioSession() {
        device.setKeepRunning(true)
        ensureMic()
    }

    private func exitAudioSession() {
        device.transmitting = false
        device.setKeepRunning(micTest)
    }

    // ================================================================ 話す (PTT)

    func pttPress() { RT.post { [self] in pressed = true; startTransmission(quiet: false) } }

    /// スワイプと判定した: 送信中なら、終了音を鳴らさずにすぐ止める。
    func pttAbort() { RT.post { [self] in pressed = false; stopTransmission(quiet: true) } }

    func pttRelease() { RT.post { [self] in pressed = false; stopTransmission() } }

    // ================================================================ モールス送信 (Web 版 startMorse の移植)

    private var morseQueue: [Character] = []
    private var morsePlaying = false
    private var morseSession = 0
    private var morseJob: Job?

    /// モールスのキーボードの1キー。「ESC」は、紙を隠して E S C を送る。「BS」は、送信待ちの最後を消す。
    func morseKey(_ k: String) {
        RT.post { [self] in
            guard currentKey != nil, room != nil else { return }
            if faxMode { faxKey(k); return }
            // 「fax」と続けて打つと、隠しの FAX モードに入る (Web 版と同じ)
            if k.count == 1 {
                faxProbe = String((faxProbe + k.lowercased()).suffix(3))
                if faxProbe == "fax" { faxProbe = ""; enterFaxMode(); return }
            } else { faxProbe = "" }
            if k == "ESC" {
                faxRx.hide()
                morseQueue.append(contentsOf: ["E", "S", "C"])
            } else if k == "BS" {
                if !morseQueue.isEmpty { morseQueue.removeLast() }
            } else if let c = k.first, k.count == 1, morseCode[c] != nil {
                morseQueue.append(c)
            } else { return }
            st.morseText = String(morseQueue)
            commit()
            startMorse()
        }
    }

    // ================================================================ FAX 送信 (隠しモード。Web 版 startFaxTx の移植)

    private var faxMode = false, faxText = "", faxProbe = ""
    private var faxTxActive = false
    private var faxSession = 0
    private var faxJobs: [Job] = []
    private var faxPaperTx = FaxPaper()
    private var faxPageAction: TrysteroRoom.Action?

    private func enterFaxMode() {
        // 打ちかけのモールスは捨てる (送信中なら止める)
        if isTransmitting { stopTransmission(quiet: true) } else { resetMorse() }
        faxMode = true
        faxText = ""
        st.faxAnalog = faxAnalog
        faxPaperTx = FaxPaper()
        st.faxPaper = faxPaperTx
        st.faxCompose = ""
        st.morseText = ""
        commit()
    }

    private func exitFaxMode() {
        if faxTxActive { stopTransmission(quiet: true) }
        faxMode = false; faxText = ""; faxProbe = ""
        st.faxCompose = nil
        flash("FAXモード終了")
    }

    /// FAX の送り方。false = アナログライクデジタル (音と同時に、中身もデータ便で送る。きれいに読める) /
    /// true = 完全アナログ (音だけ。受信側が音から読むので、ゆがみもそのまま出る)。端末に保存 (Web 版は pochitalk_fax_analog)。
    private var faxAnalog: Bool {
        get { defaults.bool(forKey: "pochitalk_fax_analog") }
        set { defaults.set(newValue, forKey: "pochitalk_fax_analog") }
    }

    /// FAX モード中のキー: 文字は書き足し、BS で消し、⏎ で送信、ESC で終了 (紙を隠して、モールスで「ESC」も送る)。
    private func faxKey(_ k: String) {
        if k == "ESC" {
            exitFaxMode()
            faxRx.hide()
            st.faxPaper = nil
            morseQueue.append(contentsOf: ["E", "S", "C"])
            st.morseText = String(morseQueue)
            commit()
            startMorse()
            return
        }
        if faxTxActive { return } // 送信中は、打てない
        if k == "TAB" { faxAnalog.toggle(); st.faxAnalog = faxAnalog; flash(faxAnalog ? "FAX: 完全アナログ（音だけで送る。ゆがみもそのまま出ます）" : "FAX: アナログライクデジタル（中身はデータでも届ける。きれいに読めます）"); commit(); return }
        switch k {
        case "ENTER": if !faxText.isEmpty { startFaxTx() }
        case "BS": if !faxText.isEmpty { faxText.removeLast() }
        default: if k.count == 1, faxText.count < 24 { faxText += k }
        }
        st.faxCompose = faxText
        commit()
    }

    private func startFaxTx() {
        guard !faxTxActive, !faxText.isEmpty, room != nil, !isTransmitting else { return }
        if othersTalking() > 0 { sounds.playBusy(); flash("話中です"); return }
        guard micGranted else { flash("マイクの許可が必要です"); requestMic(); return }
        ensureMic()
        let grid = FaxText.grid(faxText)
        faxSession += 1
        let session = faxSession
        faxTxActive = true
        isTransmitting = true
        device.toneHz = 1500; device.toneAmp = 0.2; device.morseKey = false
        device.morseMode = true
        device.transmitting = true
        diag("FAX送信開始 (\(grid.first?.count ?? 0)列)")
        setStatus(.tx, "TX (FAX送信中)", ledTx: true, ledRx: st.ledRx)
        pttStateAction?.sendJson(["isTalking": true])
        announce()
        renderScan()
        faxPaperTx = FaxPaper()
        st.faxPaper = faxPaperTx
        commit()
        if !faxAnalog { faxPageAction?.sendJson(FaxText.payload(grid)) } // 中身はデータ便でも先に送る (表示は音に合わせて後から)。完全アナログのときは送らない

        // 時刻つきの動作の列に直して、順に予約する
        var events: [(Int, () -> Void)] = []
        var at = 500
        func tone(_ hz: Double, _ ms: Int, _ also: (() -> Void)? = nil) {
            events.append((at, { [self] in device.toneHz = hz; device.morseKey = true; also?() }))
            at += ms
        }
        let F = (pre: 1500.0, sync: 900.0, white: 1300.0, black: 2100.0)
        tone(F.pre, 700) // ピー (受信開始の合図): 受信側が確実に拾えるよう長めに
        func row(_ cells: [Bool]?, _ y: Int) {
            tone(F.sync, 150)
            let cols = cells?.count ?? 0
            guard let cells, cells.contains(true) else { tone(F.white, 80); return } // 空行は短く
            var x = 0
            while x < cols {
                var x2 = x + 1
                while x2 < cols && cells[x2] == cells[x] { x2 += 1 }
                let black = cells[x], from = x, to = x2
                tone(black ? F.black : F.white, (x2 - x) * Int(FaxReceiver.pxMs)) { [self] in
                    if black { for px in from..<min(to, FaxPaper.cols) { faxPaperTx.pixels[y * FaxPaper.cols + px] = 1 } }
                    st.faxPaper = faxPaperTx
                    commit()
                }
                x = x2
            }
        }
        row(nil, 0) // 先頭の空行 (余白)
        for y in 0..<FaxReceiver.textRows { row(grid[y], 1 + y) }
        at += 150
        events.append((at, { [self] in stopTransmission(quiet: true) }))
        faxJobs = events.map { (t, f) in
            RT.after(t) { [self] in
                guard session == faxSession, faxTxActive else { return }
                f()
            }
        }
    }

    /// 送信を終えた・止めたとき、モールスの状態をすべて戻す (stopTransmission 系から呼ぶ)。
    private func resetMorse() {
        morseSession += 1
        faxSession += 1; faxTxActive = false
        faxJobs.forEach { $0.cancel() }; faxJobs = []
        device.toneHz = 700; device.toneAmp = 0.35
        morseJob?.cancel(); morseJob = nil
        morseQueue.removeAll(); morsePlaying = false
        device.morseMode = false; device.morseKey = false
        st.morseText = ""; st.morseSent = ""
    }

    private func startMorse() {
        if morsePlaying { return }
        if room == nil || isTransmitting { morseQueue.removeAll(); st.morseText = ""; return }
        if othersTalking() > 0 { sounds.playBusy(); flash("話中です"); morseQueue.removeAll(); st.morseText = ""; commit(); return }
        guard micGranted else { morseQueue.removeAll(); st.morseText = ""; flash("マイクの許可が必要です"); requestMic(); return }
        ensureMic()
        morsePlaying = true
        morseSession += 1
        let session = morseSession
        isTransmitting = true
        device.morseKey = false
        device.morseMode = true
        device.transmitting = true
        diag("モールス送信開始")
        setStatus(.tx, "TX (モールス送信中)", ledTx: true, ledRx: st.ledRx)
        pttStateAction?.sendJson(["isTalking": true])
        announce()
        renderScan()
        // 打ち始める前の間 (受信側の復号リセットと回線の落ち着き待ち。最初の文字を拾わせるため長め)
        morseJob = RT.after(700) { [self] in morseNext(session, first: true) }
    }

    private func morseNext(_ session: Int, first: Bool) {
        guard session == morseSession else { return }
        guard !morseQueue.isEmpty else {
            morsePlaying = false
            stopTransmission(quiet: true) // resetMorse も、ここで走る
            return
        }
        let ch = morseQueue.removeFirst()
        st.morseSent = String((st.morseSent + String(ch)).suffix(20)) // 送り終えた分 + いま送る文字
        st.morseText = String(morseQueue); commit()
        if ch == " " { morseJob = RT.after(600) { [self] in morseNext(session, first: first) }; return }
        guard let pat = morseCode[ch] else { return morseNext(session, first: first) }
        // (キーを押すか, ミリ秒) の列に直して、順に実行する
        var steps: [(Bool, Int)] = []
        let sym = Array(pat)
        for (i, c) in sym.enumerated() {
            steps.append((true, c == "." ? 100 : 300))
            if i < sym.count - 1 { steps.append((false, first ? 150 : 100)) } // 先頭文字は隙間を広めに
        }
        steps.append((false, morseQueue.isEmpty ? 400 : 100)) // 最後の文字のあとは、長めに黙る (受け側が、最後の点を点と数えられるように)
        func run(_ i: Int) {
            guard session == morseSession else { return }
            if i == steps.count {
                morseJob = RT.after(morseQueue.isEmpty ? 0 : 200) { [self] in morseNext(session, first: false) }
                return
            }
            device.morseKey = steps[i].0
            morseJob = RT.after(steps[i].1) { run(i + 1) }
        }
        run(0)
    }

    private func othersTalking() -> Int { peers.filter { $0.state.talking }.count }

    private func startTransmission(quiet: Bool) {
        if isTransmitting { return }
        if room == nil { return flash(reconnecting ? "再接続中です。少し待ってください" : "先に部屋に入ってください") }
        if othersTalking() > 0 {
            // 他の人が話している間は割り込めない
            if !quiet { sounds.playBusy(); flash("話中です") }
            return
        }
        guard micGranted else {
            flash("マイクの許可が必要です")
            requestMic()
            return
        }
        ensureMic()
        if !pressed { return }
        isTransmitting = true
        diag("送信開始 (quiet=\(quiet), 音声: \(device.diagnostics))")
        device.transmitting = true
        setStatus(.tx, "TX (送信中)", ledTx: true, ledRx: st.ledRx)
        sounds.playStart()
        pttStateAction?.sendJson(["isTalking": true])
        announce()
        renderScan()
    }

    private func stopTransmissionSilently() {
        if !isTransmitting { return }
        isTransmitting = false
        device.transmitting = false
        resetMorse()
        st.ledTx = false
        pttStateAction?.sendJson(["isTalking": false])
        announce()
        renderScan()
    }

    private func stopTransmission(quiet: Bool = false) {
        if !isTransmitting { return }
        diag("送信終了")
        isTransmitting = false
        device.transmitting = false
        resetMorse()
        if let id = currentTalkerId, let talker = peer(id) {
            onStartReceiving(talker.name)
        } else {
            setStatus(.standby, "STANDBY", ledTx: false, ledRx: false)
        }
        st.ledTx = false
        if !quiet { sounds.playEnd() }
        pttStateAction?.sendJson(["isTalking": false])
        announce()
        renderScan()
    }

    private func onPttState(_ peerId: String, _ talking: Bool) {
        let p = peer(peerId)
        RT.log("pttState from \(peerId.prefix(5)) talking=\(talking)")
        diag("受信: \(peerId.prefix(5)) talking=\(talking)")
        p?.talking = talking
        if talking {
            currentTalkerId = peerId
            morseRx.reset()
            if isTransmitting {
                // ほぼ同時に話し始めた: お互いの送信が切れて混線
                pressed = false
                stopTransmissionSilently()
                showCrosstalk()
                flash("混線！ もう一度押してください")
            } else if othersTalking() >= 2 {
                showCrosstalk()
            } else {
                onStartReceiving(p?.name ?? "相手")
            }
        } else if currentTalkerId == peerId {
            RT.after(600) { [self] in morseRx.flush() } // 音声の末尾が届き切ってから確定する
            onStopReceiving()
        }
        renderPeers()
    }

    /// 受信音のトーンを読む: モールスは文字に、FAX は紙に。部屋にいる間だけ回す。
    private func startToneDecoding() {
        toneJob?.cancel()
        morseRx.onRender = { [self] s in st.rxText = s; commit() }
        morseRx.onEsc = { [self] in faxRx.hide() }
        faxRx.onPaper = { [self] p in st.faxPaper = p; commit() }
        _ = device.tones.drain()
        toneJob = RT.every(15) { [self] in
            for b in device.tones.drain() { morseRx.process(b); faxRx.process(b) }
        }
    }

    private func stopToneDecoding() {
        toneJob?.cancel(); toneJob = nil
        morseRx.reset()
        faxRx.hide()
    }

    private func onStartReceiving(_ name: String) { setStatus(.rx, "RX: \(name)", ledTx: st.ledTx, ledRx: true) }

    private func onStopReceiving() {
        currentTalkerId = nil
        st.ledRx = false
        if !isTransmitting {
            setStatus(.standby, "STANDBY", ledTx: false, ledRx: false)
            sounds.playEnd()
        }
        commit()
    }

    private func showCrosstalk() {
        sounds.playCrosstalk()
        setStatus(.crosstalk, "混線！", ledTx: false, ledRx: st.ledRx)
        crosstalkJob?.cancel()
        crosstalkJob = RT.after(1300) { [self] in
            if !isTransmitting && currentTalkerId == nil { setStatus(.standby, "STANDBY", ledTx: false, ledRx: false) }
        }
    }

    private func resetStatus() { setStatus(.standby, "STANDBY", ledTx: false, ledRx: false) }

    private func setStatus(_ kind: StatusKind, _ text: String, ledTx: Bool, ledRx: Bool) {
        st.status = kind; st.statusText = text; st.ledTx = ledTx; st.ledRx = ledRx
        commit()
    }

    private func renderPeers() {
        st.peers = peers.map { PeerInfo(id: $0.id, name: $0.state.name, talking: $0.state.talking) }
        commit()
    }

    private func flash(_ text: String) {
        st.flash = text
        commit()
        flashJob?.cancel()
        flashJob = RT.after(2_500) { [self] in st.flash = nil; commit() }
    }

    // ================================================================ 設定 / VOX

    /// 入力レベル (マイクの増幅)。声が小さく伝わる端末で上げる。0〜30 dB。
    func setMicGainDb(_ db: Int) {
        RT.post { [self] in
            let v = min(30, max(0, db))
            device.gain = Float(pow(10.0, Double(v) / 20))
            st.micGainDb = v
            defaults.set(v, forKey: "pochitalk_input_db")
            commit()
        }
    }

    func setWelcomeOn(_ on: Bool) {
        RT.post { [self] in
            st.welcomeOn = on
            if on { defaults.removeObject(forKey: "pochitalk_welcome") } else { defaults.set("off", forKey: "pochitalk_welcome") }
            commit()
        }
    }

    /// 設定のマイクテスト。入室しなくても、入力レベルとメーターを確認できる。音は送信も保存もしない。設定を閉じたら止める。
    func setMicTest(_ on: Bool) {
        RT.post { [self] in
            if on {
                if room != nil { return }
                guard micGranted else {
                    flash("マイクの許可が必要です")
                    requestMic()
                    return
                }
            }
            micTest = on
            st.micTest = on
            if room == nil { device.setKeepRunning(on) }
            commit()
        }
    }

    /// 効果音の音量 (0〜150%)。0 にすると消える。
    func setSfxVolume(_ percent: Int) {
        RT.post { [self] in
            let v = min(150, max(0, percent))
            sounds.volume = Float(v) / 100
            st.sfxVolume = v
            defaults.set(v, forKey: "pochitalk_sfx_vol")
            commit()
        }
    }

    /// 音量を変えたときの試し聴き (発話終了の「ガッ」)。スライダーを動かしている間は、0.3 秒に 1 回まで。部屋の外でも鳴る。
    private var lastSfxPreview = 0
    func previewSfx(throttled: Bool = false) {
        RT.post { [self] in
            let now = RT.nowMs()
            if throttled && now - lastSfxPreview < 300 { return }
            lastSfxPreview = now
            sounds.playPreview()
        }
    }

    func setAutoReconnect(_ on: Bool) {
        RT.post { [self] in
            autoReconnect = on
            st.autoReconnect = on
            if on { defaults.set(true, forKey: "pochitalk_auto_reconnect") } else { defaults.removeObject(forKey: "pochitalk_auto_reconnect") }
            mismatchSince = 0; mismatchNoted = false
            commit()
        }
    }

    func setLefty(_ on: Bool) {
        RT.post { [self] in
            st.lefty = on
            if on { defaults.set("1", forKey: "pochitalk_lefty") } else { defaults.removeObject(forKey: "pochitalk_lefty") }
            commit()
        }
    }

    func setPttPosition(_ pos: PttPosition) {
        RT.post { [self] in
            st.pttPos = pos
            if pos == .center { defaults.removeObject(forKey: "pochitalk_ptt_pos") } else { defaults.set(pos.rawValue, forKey: "pochitalk_ptt_pos") }
            commit()
        }
    }

    /// スピーカーのミュート切り替え (相手の声と効果音を止める。マイクは止めない)。
    func toggleSpeakerMute() {
        RT.post { [self] in
            let muted = !st.speakerMuted
            device.speakerMuted = muted
            st.speakerMuted = muted
            flash(muted ? "スピーカーをミュートしました" : "スピーカーのミュートを解除しました")
        }
    }

    /// 1〜10の値が大きいほど、大きな声が必要になる (Web 版と同じ向き)。0.0015〜0.04 を対数目盛り (1段あたり約1.44倍) にしている。
    private func voxThreshold() -> Float { Float(0.0015 * pow(1.44, Double(st.voxSens - 1))) }

    /// VOX メーター用: 音量を dB (-60〜-20dB) で 0..1 にする。小さい音も見えるように対数にしている。
    private func voxMeterFraction(_ level: Float) -> Float {
        if level <= 1e-5 { return 0 }
        let db = 20 * log10(Double(level))
        return Float(min(1, max(0, (db + 60) / 40)))
    }

    func setVoxSensitivity(_ sens: Int) {
        RT.post { [self] in
            st.voxSens = min(10, max(1, sens))
            st.voxThreshold = voxMeterFraction(voxThreshold())
            defaults.set(st.voxSens, forKey: "pochitalk_vox_level")
            commit()
        }
    }

    func setVox(_ on: Bool) {
        RT.post { [self] in
            if on {
                guard micGranted else {
                    flash("マイクの許可が必要です")
                    requestMic()
                    return
                }
                ensureMic()
                device.setKeepRunning(true)
                st.voxOn = true
                voxHits = 0
                voxJob?.cancel()
                voxJob = RT.every(50) { [self] in voxTick() }
                commit()
            } else {
                stopVoxInternal()
            }
        }
    }

    private func stopVoxInternal() {
        voxJob?.cancel()
        voxJob = nil
        if voxInitiated && isTransmitting { pressed = false; stopTransmission() }
        voxInitiated = false
        st.voxOn = false
        st.voxLevel = 0
        commit()
    }

    /// 直近300ms以内に録音が動いていれば、その音量 (ゲイン後)。止まっていれば nil。
    private func currentMicLevel() -> Float? {
        ProcessInfo.processInfo.systemUptime - device.lastCaptureAt <= 0.3 ? device.micLevel : nil
    }

    private func voxTick() {
        let now = RT.nowMs()
        let lvl = currentMicLevel() ?? 0
        let thr = voxThreshold()
        st.voxLevel = voxMeterFraction(lvl)
        st.voxThreshold = voxMeterFraction(thr)
        if uiActive { commit() }
        if room == nil { voxHits = 0; return }
        if !isTransmitting {
            voxInitiated = false
            // 他の人が話している間は割り込まない
            if lvl > thr && othersTalking() == 0 && now > voxCooldownUntil {
                voxHits += 1
                if voxHits >= 3 {
                    voxHits = 0
                    voxInitiated = true
                    voxLastVoice = now
                    pressed = true
                    startTransmission(quiet: true)
                }
            } else if lvl <= thr {
                voxHits = 0
            }
        } else if voxInitiated {
            if lvl > thr * Self.voxHoldRatio {
                voxLastVoice = now
            } else if now - voxLastVoice > Self.voxHoldMs {
                pressed = false
                voxInitiated = false
                stopTransmission()
                voxCooldownUntil = RT.nowMs() + Self.voxCooldownMs
            }
        }
    }

    // ================================================================ 音量レベルメーター

    /// 送信中は自分のマイク (TX)、誰かが話していればその音声 (RX)、それ以外はマイク待機 (MIC)。
    private func meterTick() {
        if room == nil && !micTest {
            if meter != MeterState() {
                meterLevel = 0; meterPeak = 0
                DispatchQueue.main.async { self.meter = MeterState() }
            }
            return
        }
        let now = RT.nowMs()
        let micNow = currentMicLevel()
        var label = "LEVEL"
        var rms: Double?
        if isTransmitting {
            label = "TX"
            if let m = micNow { rms = Double(m) }
        } else if let talker = currentTalkerId {
            label = "RX"
            pollRxLevel(talker, now)
            rms = rxLevel
        } else if let m = micNow {
            label = "MIC"
            rms = Double(m)
        }
        let db: Double? = (rms ?? 0) > 1e-5 ? 20 * log10(rms!) : nil
        let target: Float = db.map { Float(min(1, max(0, ($0 + 60) / 60))) } ?? 0
        // Web 版は60fps前提の係数 (上がり0.5 / 下がり0.12 / ピーク減衰0.02) を、50ms刻みに換算している
        meterLevel += (target - meterLevel) * (target > meterLevel ? 0.875 : 0.32)
        if meterLevel >= meterPeak {
            meterPeak = meterLevel
            meterPeakHoldUntil = now + 800
        } else if now > meterPeakHoldUntil {
            meterPeak = max(meterLevel, meterPeak - 0.06)
        }
        if !uiActive { return } // 画面が見えていない (ロック中など) 間は、メーターを描かない
        let m = MeterState(label: label, level: meterLevel, peak: meterPeak, dbText: db.map { "\(Int($0.rounded())) dB" } ?? "-∞ dB")
        DispatchQueue.main.async { self.meter = m }
    }

    private func pollRxLevel(_ peerId: String, _ now: Int) {
        if rxPolling || now - rxPolledAt < 150 { return }
        rxPolling = true
        rxPolledAt = now
        guard let r = room else { rxPolling = false; return }
        r.fetchInboundAudioLevel(peerId: peerId) { [self] level in
            rxPolling = false
            rxLevel = level ?? 0
        }
    }
}
