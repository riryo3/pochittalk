import CryptoKit
import Foundation
import WebRTC

/// Trystero 0.25.4 の strategy.ts + signal-handler.ts (相手探しとオファー/アンサー/候補の交換)、
/// shared-peer.ts (部屋トークン付きフレーム)、handshake.ts (接続後の確認)、room.ts / actions.ts (アクション) を、
/// このアプリに必要な範囲で移植したもの (Android 版 TrysteroRoom.kt と同じ形)。呼び出しはすべて RT.queue 上で行うこと。
///
/// 通信の形 (Web 版と同じ):
///  1. 部屋ごとの rootTopic = sha1("Trystero@appId@roomId") と、自分宛の selfTopic = sha1(root@selfId) を購読する。
///  2. rootTopic に {"peerId": selfId} を投稿 (announce)。0.23s, 0.5s, 1.3s のあと60秒おき。
///  3. announce を見たとき、selfId が小さい側がオファーを作って相手の selfTopic へ送る。
///     大きい側は、自分の announce を相手の selfTopic へ返して、オファーを待つ。
///  4. オファー/アンサー/候補は AES-GCM で暗号化した文字列。 {peerId, offerId, offer|answer|candidate}
///  5. データチャネルが開いたら、部屋トークン付きのフレームで @_hsready を送り合い、両方そろったら入室扱いにする。
final class TrysteroRoom {
    let appId: String
    let roomId: String
    private unowned let net: TrysteroNetwork
    private let selfId: String
    private let rootTopicPlain: String
    private let rootTopic: String
    private let selfTopic: String
    private let key: SymmetricKey
    private let roomToken: String

    private var left = false
    private var subIds: [(Int, String)] = []
    private var announceJobs: [Job] = []

    private final class OfferInfo {
        let peer: RtcPeer; let id: String; let cipher: String
        init(peer: RtcPeer, id: String, cipher: String) { self.peer = peer; self.id = id; self.cipher = cipher }
    }

    private final class PState {
        var connected: RtcPeer?
        var unhealthySince = 0
        var offerPeer: RtcPeer?
        var offerInfo: OfferInfo?
        var offerIniting = false
        var offerInitWaiters: [(OfferInfo?) -> Void] = []
        var offerAnswered = false
        var offerRelays: [Int: Job?] = [:]
        var signalRelays = Set<Int>()
        var offerBacklog: [String] = []
        var offerExpiry: Job?
        var answering: RtcPeer?
        var answerSent = false
        var answeringExpiry: Job?
        var pendingCandidates: [String: [String]] = [:]
    }

    private var states: [String: PState] = [:]
    private func state(_ peerId: String) -> PState {
        if let s = states[peerId] { return s }
        let s = PState(); states[peerId] = s; return s
    }

    private final class Slot {
        let id: String; let peer: RtcPeer
        let reassembler = ActionCodec.Reassembler()
        var localPassed = false, remoteReady = false, active = false
        var timeout: Job?
        init(id: String, peer: RtcPeer) { self.id = id; self.peer = peer }
    }
    private var slots: [String: Slot] = [:]

    private struct LocalTrack { let track: RTCMediaStreamTrack; let streamId: String; let streamKey: String }
    private var localTracks: [LocalTrack] = []
    private var actions: [String: Action] = [:]

    var onPeerJoin: ((String) -> Void)?
    var onPeerLeave: ((String) -> Void)?

    var peerIds: Set<String> { Set(slots.values.filter { $0.active }.map { $0.id }) }

    // ================================================================ アクション

    final class Action {
        let type: String
        let sendToPending: Bool
        let receiveWhilePending: Bool
        private unowned let room: TrysteroRoom
        private var nonce = 0
        var onMessage: ((ActionCodec.Message, String) -> Void)?

        init(room: TrysteroRoom, type: String, sendToPending: Bool, receiveWhilePending: Bool) {
            self.room = room; self.type = type; self.sendToPending = sendToPending; self.receiveWhilePending = receiveWhilePending
        }

        func sendString(_ text: String, to: String? = nil) { send(ActionCodec.encodeString(type: type, text: text, nonce: nextNonce()), to) }
        func sendJson(_ json: [String: Any], to: String? = nil) { send(ActionCodec.encodeJson(type: type, json: json, nonce: nextNonce()), to) }

        private func nextNonce() -> Int { let n = nonce; nonce = (nonce + 1) & 0xffff; return n }

        private func send(_ chunks: [Data], _ to: String?) {
            let targets: [Slot] = to != nil ? [room.slots[to!]].compactMap { $0 } : Array(room.slots.values)
            for slot in targets {
                if !sendToPending && !slot.active { continue }
                for c in chunks { slot.peer.send(ActionCodec.wrapRoomFrame(token: room.roomToken, data: c)) }
            }
        }
    }

    /// アクションを登録する (同じ名前なら同じものを返す)。名前は32バイト以内。
    func action(_ type: String) -> Action { internalAction(type) }

    private func internalAction(_ type: String, sendToPending: Bool = false, receiveWhilePending: Bool = false) -> Action {
        if let a = actions[type] { return a }
        let a = Action(room: self, type: type, sendToPending: sendToPending, receiveWhilePending: receiveWhilePending)
        actions[type] = a
        return a
    }

    private var pingAction: Action!, pongAction: Action!, signalAction: Action!, streamMetaAction: Action!
    private var trackMetaAction: Action!, leaveAction: Action!, hsDataAction: Action!, hsReadyAction: Action!

    init(appId: String, roomId: String, net: TrysteroNetwork) {
        self.appId = appId
        self.roomId = roomId
        self.net = net
        selfId = net.selfId
        rootTopicPlain = TrysteroCrypto.topicPath("Trystero", appId, roomId)
        rootTopic = TrysteroCrypto.sha1Topic(rootTopicPlain)
        selfTopic = TrysteroCrypto.sha1Topic(TrysteroCrypto.topicPath(rootTopicPlain, net.selfId))
        key = TrysteroCrypto.genKey(secret: "", appId: appId, roomId: roomId)
        roomToken = TrysteroCrypto.deriveRoomNamespace(appId: appId, roomId: roomId)

        pingAction = internalAction("@_ping")
        pongAction = internalAction("@_pong")
        signalAction = internalAction("@_signal")
        streamMetaAction = internalAction("@_stream")
        trackMetaAction = internalAction("@_track")
        leaveAction = internalAction("@_leave", sendToPending: true, receiveWhilePending: true)
        hsDataAction = internalAction("@_hsdata", sendToPending: true, receiveWhilePending: true)
        hsReadyAction = internalAction("@_hsready", sendToPending: true, receiveWhilePending: true)

        pingAction.onMessage = { [weak self] _, id in self?.pongAction.sendString("", to: id) }
        pongAction.onMessage = { _, _ in }
        signalAction.onMessage = { [weak self] msg, id in
            guard let slot = self?.slots[id], slot.active, msg.isJson else { return }
            let j = msg.json()
            if let t = j["type"] as? String, let s = j["sdp"] as? String, !t.isEmpty, !s.isEmpty { slot.peer.signal(t, s) }
        }
        streamMetaAction.onMessage = { _, _ in } // 受け取った音声は libwebrtc が自動で再生する
        trackMetaAction.onMessage = { _, _ in }
        hsDataAction.onMessage = { _, _ in }
        hsReadyAction.onMessage = { [weak self] _, id in
            guard let self, let slot = self.slots[id] else { return }
            slot.remoteReady = true
            self.maybeActivate(slot)
        }
        leaveAction.onMessage = { [weak self] _, id in self?.exitPeer(id, nil) }
    }

    /// 音声が通っている相手の数 (自分を含まない)。在室通知の cn。
    func goodLinkCount() -> Int { slots.values.filter { $0.active && $0.peer.audioOK() }.count }

    func fetchInboundAudioLevel(peerId: String, _ cb: @escaping (Double?) -> Void) {
        if let slot = slots[peerId] { slot.peer.fetchInboundAudioLevel(cb) } else { cb(nil) }
    }

    /// 自分の音声トラックを共有する。すでに入室扱いの相手と、これから入る相手の両方に流す。
    func addLocalTrack(_ track: RTCMediaStreamTrack, streamId: String) {
        if !localTracks.contains(where: { $0.track === track }) {
            localTracks.append(LocalTrack(track: track, streamId: streamId, streamKey: TrysteroCrypto.genId(20)))
        }
        guard let lt = localTracks.first(where: { $0.track === track }) else { return }
        for s in slots.values where s.active { attachTrack(s, lt) }
    }

    private func attachTrack(_ slot: Slot, _ lt: LocalTrack) {
        // ブラウザ側は、メタ情報 {k, s} を先に受け取ってから届いた音声を再生する
        streamMetaAction.sendJson(["k": lt.streamKey, "s": lt.streamId], to: slot.id)
        slot.peer.addTrack(lt.track, streamId: lt.streamId)
    }

    func leave() {
        if left { return }
        left = true
        leaveAction.sendString("")
        RT.after(99) { [self] in
            slots.values.forEach { $0.peer.destroy("leave") }
            slots.removeAll()
            for st in states.values {
                st.offerExpiry?.cancel(); st.answeringExpiry?.cancel()
                st.offerRelays.values.forEach { $0?.cancel() }
                st.offerPeer?.destroy("leave"); st.answering?.destroy("leave"); st.connected?.destroy("leave")
            }
            states.removeAll()
            announceJobs.forEach { $0.cancel() }
            announceJobs.removeAll()
            for (i, subId) in subIds { net.unsubscribe(clientIndex: i, subId: subId) }
            subIds.removeAll()
            net.roomClosed(appId: appId, roomId: roomId, room: self)
        }
    }

    // ================================================================ 接続後 (room.ts / handshake.ts)

    private func handleFrame(_ id: String, _ slot: Slot, _ bytes: Data) {
        guard let frame = ActionCodec.unwrapFrame(bytes) else { return }
        switch frame {
        case .presence: break // 部屋は1つしか使わないので、他の部屋の在室通知は不要
        case .room(let token, let payload):
            if token == roomToken { handleData(id, slot, payload) }
        }
    }

    private func handleData(_ id: String, _ slot: Slot, _ payload: Data) {
        guard let type = ActionCodec.peekType(payload), let action = actions[type] else { return } // 未登録 (faxPage など) は捨てる
        if !slot.active && !action.receiveWhilePending { return }
        guard let msg = slot.reassembler.feed(payload) else { return }
        action.onMessage?(msg, id)
    }

    private func maybeActivate(_ slot: Slot) {
        if slot.active || slots[slot.id] !== slot { return }
        if !slot.localPassed || !slot.remoteReady { return }
        slot.active = true
        slot.timeout?.cancel()
        localTracks.forEach { attachTrack(slot, $0) }
        onPeerJoin?(slot.id)
    }

    private func exitPeer(_ id: String, _ peer: RtcPeer?) {
        guard let slot = slots[id] else { return }
        if let peer, slot.peer !== peer { return }
        slots.removeValue(forKey: id)
        slot.timeout?.cancel()
        if let st = states[id], st.connected === slot.peer { st.connected = nil; st.unhealthySince = 0 }
        slot.peer.destroy("exit")
        if slot.active { onPeerLeave?(id) }
        if !left { requeueAnnounce() } // 相手が消えたら、すぐ探し直す
    }

    /// データチャネルが開いた相手を部屋に渡す (shared-peer の bind + room の onPeer)。
    private func onPeerConnect(_ peer: RtcPeer, _ id: String) {
        if let old = slots[id] {
            if old.peer === peer { return }
            old.peer.destroy("replaced")
            slots.removeValue(forKey: id)
        }
        let slot = Slot(id: id, peer: peer)
        slots[id] = slot
        peer.setDataHandler { [weak self] bytes in self?.handleFrame(id, slot, bytes) }
        peer.onClose = { [weak self] in self?.exitPeer(id, peer) }
        peer.onError = { [weak self] e in RT.log("peer \(id) error: \(e)"); self?.exitPeer(id, peer) }
        // 接続後の SDP と候補は、すべてデータチャネルの @_signal で送る (入室扱いになってから)
        peer.setSignalHandler { [weak self] type, sdp in
            if slot.active { self?.signalAction.sendJson(["type": type, "sdp": sdp], to: id) }
        }
        // この相手に、この部屋にいることを知らせる (shared-peer の在室フレーム)
        peer.send(ActionCodec.wrapPresenceFrame(token: roomToken, isPresent: true))
        // 確認の制限時間は10秒。パスワード無しなので、こちらは即「確認済み」として準備完了を送る
        slot.timeout = RT.after(Self.handshakeTimeoutMs) { [weak self] in
            guard let self, self.slots[id] === slot, !slot.active else { return }
            RT.log("handshake timed out: \(id)")
            self.exitPeer(id, peer)
        }
        slot.localPassed = true
        hsReadyAction.sendString("", to: id)
        maybeActivate(slot)
    }

    // ================================================================ 相手探し (strategy.ts / signal-handler.ts)

    func start() {
        for i in net.relays.indices {
            let subId = net.subscribe(room: self, clientIndex: i, topics: [rootTopic, selfTopic])
            subIds.append((i, subId))
            announceJobs.append(announceLoop(i))
        }
    }

    private func announceLoop(_ relay: Int) -> Job {
        let job = Job()
        var attempt = 0
        func tick() {
            guard !left, !job.isCancelled else { return }
            net.relays[relay].publish(topic: rootTopic, content: JSON.string(["peerId": selfId]))
            let warm = attempt < Self.announceWarmupMs.count ? Self.announceWarmupMs[attempt] : nil
            attempt += 1
            let wait = warm.map { min(Self.announceSteadyMs, $0) } ?? Self.announceSteadyMs
            job.chain(RT.after(wait) { tick() })
        }
        tick()
        return job
    }

    private func requeueAnnounce() {
        if left { return }
        announceJobs.forEach { $0.cancel() }
        announceJobs.removeAll()
        for i in net.relays.indices { announceJobs.append(announceLoop(i)) }
    }

    private var reannounceJob: Job?

    private func reannounceSoon() {
        if left || reannounceJob != nil { return }
        reannounceJob = RT.after(1_000) { [weak self] in
            self?.reannounceJob = nil
            self?.requeueAnnounce()
        }
    }

    private func newPeer(initiator: Bool) -> RtcPeer { RtcPeer(factory: net.factory, iceServers: net.iceServers(), initiator: initiator) }

    private func unfinishedCount() -> Int { states.values.filter { $0.offerPeer != nil || $0.answering != nil }.count }

    private func peerTopic(_ peerId: String) -> String { TrysteroCrypto.sha1Topic(TrysteroCrypto.topicPath(rootTopicPlain, peerId)) }

    /// リレーから届いたメッセージ (announce / offer / answer / candidate) を処理する。
    func handleRelayMessage(relay: Int, topic: String, raw: String) {
        if left { return }
        guard let payload = JSON.object(raw) else { return }
        for k in Self.signalKeys {
            if let v = payload[k], !((v as? String).map { !$0.isEmpty } ?? false) { return }
        }
        guard let peerId = payload["peerId"] as? String, !peerId.isEmpty, peerId != selfId else { return }
        if topic != rootTopic && topic != selfTopic { return }
        let offer = (payload["offer"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let answer = (payload["answer"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let candidate = (payload["candidate"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let offerId = (payload["offerId"] as? String).flatMap { $0.isEmpty ? nil : $0 }

        let st = state(peerId)
        if let connected = st.connected {
            switch connected.health() {
            case .live:
                st.unhealthySince = 0
                return
            case .stale:
                clearConnected(st)
            case .transient:
                let now = RT.nowMs()
                if st.unhealthySince == 0 { st.unhealthySince = now }
                if now - st.unhealthySince < Self.disconnectedGraceMs { return }
                clearConnected(st)
            }
        }
        if offer == nil && answer == nil && candidate == nil {
            handleAnnouncement(relay, peerId, st)
        } else if let offer {
            handleOffer(relay, peerId, st, offer, offerId)
        } else if let candidate {
            handleCandidate(peerId, st, candidate, offerId)
        } else if let answer {
            handleAnswer(peerId, st, answer, offerId)
        }
    }

    private func clearConnected(_ st: PState) {
        guard let p = st.connected else { return }
        st.connected = nil
        st.unhealthySince = 0
        if !p.isDead { p.destroy("stale") }
    }

    private func handleAnnouncement(_ relay: Int, _ peerId: String, _ st: PState) {
        if st.answering != nil || st.connected != nil || st.offerAnswered { return }
        let lead = selfId < peerId
        RT.log("announce from \(peerId.prefix(5)) via relay \(relay) (lead=\(lead))")
        if !lead && st.offerPeer == nil && !st.offerIniting {
            // オファーを作るのは相手の役目。こちらの存在を相手の selfTopic へ知らせて待つ
            net.relays[relay].publish(topic: peerTopic(peerId), content: JSON.string(["peerId": selfId]))
            return
        }
        if st.offerRelays[relay] != nil { return }
        if unfinishedCount() >= Self.maxUnfinishedPeers {
            RT.log("too many unfinished peers; announcement from \(peerId) ignored")
            return
        }
        st.offerRelays[relay] = .some(nil)
        sendOffer(relay, peerId, st)
    }

    private func ensureOffer(_ st: PState, _ peerId: String, _ done: @escaping (OfferInfo?) -> Void) {
        if let i = st.offerInfo { done(i); return }
        if st.offerIniting { st.offerInitWaiters.append(done); return }
        st.offerIniting = true
        st.offerInitWaiters = [done]
        var finished = false
        func finish(_ info: OfferInfo?) {
            if finished { return }
            finished = true
            st.offerIniting = false
            let w = st.offerInitWaiters
            st.offerInitWaiters = []
            w.forEach { $0(info) }
        }
        let peer = newPeer(initiator: true)
        let timeout = RT.after(Self.offerBuildTimeoutMs) {
            peer.destroy("offer build timeout")
            finish(nil)
        }
        peer.awaitOffer { [weak self] sdp in
            timeout.cancel()
            guard let self else { return finish(nil) }
            guard let sdp, !peer.isDead, !self.left, st.answering == nil, st.connected == nil else {
                peer.destroy("offer not usable")
                return finish(nil)
            }
            let info = OfferInfo(peer: peer, id: TrysteroCrypto.genId(Self.offerIdSize), cipher: TrysteroCrypto.encrypt(self.key, sdp))
            st.offerPeer = peer
            st.offerInfo = info
            st.offerAnswered = false
            st.offerBacklog.removeAll()
            peer.onConnect = { [weak self] in self?.connectPeer(peer, peerId) }
            let closed = { if st.offerPeer === peer && st.connected == nil { self.resetOfferState(st) } }
            peer.onClose = closed
            peer.onError = { _ in closed() }
            peer.setSignalHandler { [weak self] type, s in
                guard let self, st.offerPeer === peer, type == "candidate" else { return }
                st.offerBacklog.append(s)
                for r in st.signalRelays { self.publishCandidate(r, peerId, st, info, s) }
            }
            self.scheduleOfferExpiry(st, peerId, info.id, Self.offerTtlMs)
            finish(info)
        }
    }

    private func publishCandidate(_ relay: Int, _ peerId: String, _ st: PState, _ info: OfferInfo, _ plain: String) {
        if left || st.connected != nil || st.offerPeer !== info.peer || st.offerInfo !== info { return }
        let msg: [String: Any] = ["peerId": selfId, "offerId": info.id, "candidate": TrysteroCrypto.encrypt(key, plain)]
        net.relays[relay].publish(topic: peerTopic(peerId), content: JSON.string(msg))
    }

    private func sendOffer(_ relay: Int, _ peerId: String, _ st: PState) {
        ensureOffer(st, peerId) { [weak self] info in
            guard let self else { return }
            guard let info, !self.left, st.connected == nil, st.answering == nil, !st.offerAnswered,
                  st.offerRelays[relay] != nil, st.offerInfo === info else {
                st.offerRelays.removeValue(forKey: relay)
                return
            }
            // 一定時間たったら、このリレーでの送信済みを忘れて、次の announce でオファーを送り直せるようにする
            st.offerRelays[relay]??.cancel()
            st.offerRelays[relay] = .some(RT.after(Self.offerRelayPruneMs) {
                if st.connected == nil { st.offerRelays.removeValue(forKey: relay) }
            })
            let msg: [String: Any] = ["peerId": self.selfId, "offerId": info.id, "offer": info.cipher]
            let sent = self.net.relays[relay].publish(topic: self.peerTopic(peerId), content: JSON.string(msg))
            RT.log("offer \(info.id.prefix(4)) sent to \(peerId.prefix(5)) via relay \(relay) (sent=\(sent))")
            st.signalRelays.insert(relay)
            for c in st.offerBacklog { self.publishCandidate(relay, peerId, st, info, c) }
        }
    }

    private func resetOfferState(_ st: PState) {
        st.offerExpiry?.cancel(); st.offerExpiry = nil
        st.offerRelays.values.forEach { $0?.cancel() }
        st.offerRelays.removeAll()
        st.signalRelays.removeAll()
        st.offerBacklog.removeAll()
        let p = st.offerPeer
        st.offerPeer = nil
        st.offerInfo = nil
        st.offerAnswered = false
        if let p, p !== st.connected, !p.isDead { p.destroy("offer reset") }
    }

    private func scheduleOfferExpiry(_ st: PState, _ peerId: String, _ offerId: String, _ ttlMs: Int) {
        st.offerExpiry?.cancel()
        st.offerExpiry = RT.after(ttlMs) { [weak self] in
            guard let self, st.connected == nil, st.offerInfo?.id == offerId else { return }
            if st.offerAnswered { RT.log("could not connect to \(peerId) after exchanging SDP") }
            self.resetOfferState(st)
        }
    }

    private func handleOffer(_ relay: Int, _ peerId: String, _ st: PState, _ offerCipher: String, _ offerId: String?) {
        if st.answering != nil || st.offerAnswered { return }
        RT.log("offer \(offerId?.prefix(4) ?? "?") from \(peerId.prefix(5)) via relay \(relay)")
        let hasTracked = st.offerPeer != nil || !st.offerRelays.isEmpty || st.offerIniting
        // 同時にオファーを出し合ったら、selfId が小さい側が自分のオファーを優先する
        if hasTracked && selfId < peerId { return }
        if unfinishedCount() >= Self.maxUnfinishedPeers && !hasTracked {
            RT.log("too many unfinished peers; offer from \(peerId) ignored")
            return
        }
        if hasTracked { resetOfferState(st) }
        let plainOffer: String
        do { plainOffer = try TrysteroCrypto.decrypt(key, offerCipher) } catch {
            RT.log("offer decrypt failed (room id / app id mismatch?)")
            return
        }
        // 中身の無いオファー (m= 行が1つも無い) は、答えてもつながらない。無視して、少ししたら announce をやり直す
        // 注意: SDP の改行は CRLF。Swift の String.contains("\nm=") は CRLF を1文字と見るため当たらない。UTF-16 で探す Foundation の range(of:) を使う
        if Sdp.mediaSectionCount(plainOffer) == 0 {
            RT.log("offer from \(peerId.prefix(5)) has no media sections; ignored")
            reannounceSoon()
            return
        }
        let peer = newPeer(initiator: false)
        st.answering = peer
        st.answerSent = false
        st.answeringExpiry?.cancel()
        st.answeringExpiry = RT.after(Self.answeringTtlMs) {
            guard st.connected == nil, st.answering === peer else { return }
            if st.answerSent { RT.log("could not connect to \(peerId) after exchanging SDP") }
            st.answering = nil
            peer.destroy("answer expired")
        }
        peer.onConnect = { [weak self] in self?.connectPeer(peer, peerId) }
        let closed = {
            if st.answering === peer {
                st.answeringExpiry?.cancel()
                st.answering = nil
                st.answerSent = false
            }
        }
        peer.onClose = closed
        peer.onError = { _ in closed() }
        let replyTopic = peerTopic(peerId)
        peer.setSignalHandler { [weak self] type, sdp in
            guard let self, !self.left, st.answering === peer, !peer.isDead, type == "answer" || type == "candidate" else { return }
            var msg: [String: Any] = ["peerId": self.selfId]
            let cipher = TrysteroCrypto.encrypt(self.key, sdp)
            if type == "answer" { st.answerSent = true; msg["answer"] = cipher } else { msg["candidate"] = cipher }
            if let offerId { msg["offerId"] = offerId }
            let sent = self.net.relays[relay].publish(topic: replyTopic, content: JSON.string(msg))
            if type == "answer" { RT.log("answer sent to \(peerId.prefix(5)) via relay \(relay) (sent=\(sent))") }
        }
        peer.signal("offer", plainOffer)
        // オファーより先に届いていた候補
        for k in [offerId, Self.legacyKey].compactMap({ $0 }) {
            st.pendingCandidates.removeValue(forKey: k)?.forEach { peer.signal("candidate", $0) }
        }
    }

    private func handleCandidate(_ peerId: String, _ st: PState, _ cipher: String, _ offerId: String?) {
        guard let plain = try? TrysteroCrypto.decrypt(key, cipher) else { return }
        let offerMatch = (offerId != nil && st.offerInfo?.id == offerId) ? st.offerPeer : nil
        let fallback = offerId == nil ? st.offerPeer : nil
        let target = offerMatch ?? st.answering ?? fallback
        if target == nil || target!.isDead {
            let k = offerId ?? Self.legacyKey
            if (st.pendingCandidates[k]?.count ?? 0) < Self.maxBufferedCandidates { st.pendingCandidates[k, default: []].append(plain) }
            return
        }
        target!.signal("candidate", plain)
    }

    private func handleAnswer(_ peerId: String, _ st: PState, _ cipher: String, _ offerId: String?) {
        let plain: String
        do { plain = try TrysteroCrypto.decrypt(key, cipher) } catch { RT.log("answer decrypt failed"); return }
        guard let peer = st.offerPeer, let info = st.offerInfo, !st.offerAnswered,
              offerId == nil || offerId == info.id, !peer.isDead else { return }
        RT.log("answer from \(peerId.prefix(5)) for offer \(info.id.prefix(4))")
        st.offerAnswered = true
        scheduleOfferExpiry(st, peerId, info.id, Self.offerPostAnswerTtlMs)
        peer.signal("answer", plain)
    }

    /// データチャネルが開いた (相手とつながった)。
    private func connectPeer(_ peer: RtcPeer, _ peerId: String) {
        if left { peer.destroy("room left"); return }
        let st = state(peerId)
        if let existing = st.connected {
            if existing !== peer && !peer.isDead { peer.destroy("duplicate") }
            return
        }
        st.connected = peer
        st.unhealthySince = 0
        RT.log("connected to \(peerId.prefix(5)) (\(peer.initiator ? "offerer" : "answerer"))")
        st.answeringExpiry?.cancel()
        let ans = st.answering
        st.answering = nil
        st.answerSent = false
        if let ans, ans !== peer, !ans.isDead { ans.destroy("superseded") }
        resetOfferState(st)
        onPeerConnect(peer, peerId)
    }

    private static let signalKeys = ["offer", "answer", "candidate"]
    private static let announceWarmupMs = [233, 533, 1333]
    private static let announceSteadyMs = 60_000
    private static let offerTtlMs = 57_333
    private static let offerPostAnswerTtlMs = 23_333
    private static let answeringTtlMs = 23_333
    private static let offerRelayPruneMs = 4_800
    private static let offerIdSize = 12
    private static let disconnectedGraceMs = 7_533
    private static let handshakeTimeoutMs = 10_000
    private static let offerBuildTimeoutMs = 15_000
    private static let maxUnfinishedPeers = 12
    private static let maxBufferedCandidates = 64
    private static let legacyKey = "__legacy__"
}
