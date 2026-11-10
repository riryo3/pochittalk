import Foundation
import WebRTC

/// 部屋一覧 (在室通知)。通話の接続 (WebRTC) とは別に、Nostr リレーに「いま自分はこの部屋にいる」を流して、
/// 他の人の通知を集める。Web 版 (worker.js の presence*) と同じ形:
///   イベント kind 29334 / タグ ["x","pochitalk-presence-v1"] / content = {ch, cn, ag, talking, name, tag, by, at}  (cn=音声が通る相手の数, ag=入室からの秒数)
///   購読は since = いまの5秒前。同じイベントが複数のリレーから届くので id で重複を捨てる。
final class PresenceClient {
    private var seen: [String: Int] = [:]
    private let subId = "pochi-presence"
    private var clients: [NostrClient] = []
    private let onPresence: (_ pubkey: String, _ data: [String: Any]) -> Void

    init(urls: [String], onPresence: @escaping (String, [String: Any]) -> Void) {
        self.onPresence = onPresence
        clients = urls.enumerated().map { (i, url) in
            NostrClient(index: i, url: url) { [weak self] _, _, _, content, ev in self?.handle(content, ev) }
        }
    }

    func start() {
        for c in clients {
            c.connect()
            c.subscribe(subId: subId) { NostrProtocol.subscribePresence(subId: "pochi-presence") }
        }
    }

    func reconnect() { clients.forEach { $0.reconnect() } }
    /// 購読をやり直し、死んだ接続は張り直す。
    func refresh() { clients.forEach { $0.refresh() } }
    func close() { clients.forEach { $0.close() } }

    /// 自分の在室を全リレーに流す。
    func publish(_ data: [String: Any]) {
        let ev = NostrProtocol.createEvent(kind: NostrProtocol.presenceKind, topic: NostrProtocol.presenceTopic, content: JSON.string(data))
        clients.forEach { $0.publishRaw(ev) }
    }

    private func handle(_ content: String, _ ev: [String: Any]) {
        guard (ev["kind"] as? Int) == NostrProtocol.presenceKind else { return }
        guard let pubkey = ev["pubkey"] as? String, !pubkey.isEmpty, pubkey != NostrProtocol.publicKeyHex else { return }
        let now = RT.nowMs()
        if let id = ev["id"] as? String, !id.isEmpty {
            if seen[id] != nil { return }
            seen[id] = now
            if seen.count > 500 { seen = seen.filter { now - $0.value <= 120_000 } }
        }
        if let createdAt = ev["created_at"] as? Int, createdAt != 0, createdAt < now / 1000 - 120 { return }
        guard let data = JSON.object(content), data["ch"] is String else { return }
        onPresence(pubkey, data)
    }
}

/// Web 版と同じ顔ぶれのリレー。
enum RelayList {
    static let nostrRelayUrls = [
        "wss://relay.primal.net", "wss://purplerelay.com", "wss://bucket.coracle.social", "wss://yabu.me/v2",
        "wss://x.kojira.io", "wss://relay.notoshi.win", "wss://relay.ditto.pub",
    ]

    /// 6秒以内に開いたら「生きている」。
    private final class Probe: NSObject, URLSessionWebSocketDelegate {
        private var done: ((Bool) -> Void)?
        private var session: URLSession?
        init(url: String, done: @escaping (Bool) -> Void) {
            self.done = done
            super.init()
            guard let u = URL(string: url) else { done(false); self.done = nil; return }
            let s = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
            session = s
            s.webSocketTask(with: u).resume()
            DispatchQueue.global().asyncAfter(deadline: .now() + 6) { [self] in finish(false) }
        }
        private func finish(_ ok: Bool) {
            RT.post { [self] in
                guard let d = done else { return }
                done = nil
                session?.invalidateAndCancel()
                d(ok)
            }
        }
        func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) { finish(true) }
        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if error != nil { finish(false) } }
    }

    /// 動いているリレーを選ぶ (Web 版の pickRelaysMain と同じ): 全部を同時に調べ、ばらばらの順にして、
    /// 通話用も在室通知用も、生きているものを全部使う (端末ごとに選ぶと、共通のリレーが無い組ができて、つながらないため。Web 版・Android 版と同じ)。1本も開かなければ全部を使う。RT.queue 上から呼び、結果も RT.queue 上で返る。
    static func pick(_ done: @escaping (_ room: [String], _ presence: [String]) -> Void) {
        var results: [String: Bool] = [:]
        var probes: [Probe] = []
        for u in nostrRelayUrls {
            probes.append(Probe(url: u) { ok in
                results[u] = ok
                if results.count == nostrRelayUrls.count {
                    let alive = nostrRelayUrls.filter { results[$0] == true }.shuffled()
                    probes.removeAll()
                    if alive.isEmpty { done(nostrRelayUrls, nostrRelayUrls) }
                    else { done(alive, alive) }
                }
            })
        }
    }
}

/// TURN の資格情報。鍵は端末に持たず、Web 版の /api/turn から短命の資格情報を受け取る。取れなければ STUN だけ (直接つなぐ)。
final class TurnClient {
    static let googleStun = "stun:stun.l.google.com:19302"
    private let endpoint: URL
    private(set) var iceServers: [RTCIceServer] = [
        RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"]),
        RTCIceServer(urlStrings: [TurnClient.googleStun]),
    ]
    private(set) var hasTurn = false
    private var fetchedAt = 0

    init(endpoint: URL) { self.endpoint = endpoint }

    /// 取り直す。10分以内に取れていれば (force でなければ) 何もしない。失敗しても前回の分を使い続ける。
    func refresh(force: Bool = false, done: @escaping () -> Void) {
        if !force && fetchedAt != 0 && RT.nowMs() - fetchedAt < 10 * 60_000 { return done() }
        var req = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            RT.post { [self] in
                if let data, let code = (resp as? HTTPURLResponse)?.statusCode, (200..<300).contains(code), let list = Self.parse(data) {
                    iceServers = list + [RTCIceServer(urlStrings: [Self.googleStun])]
                    hasTurn = list.contains { $0.urlStrings.contains { $0.hasPrefix("turn:") || $0.hasPrefix("turns:") } }
                    fetchedAt = RT.nowMs()
                }
                done()
            }
        }.resume()
    }

    /// {"iceServers":[{"urls":[...]|"...", "username":"...", "credential":"..."}]} を読む。空なら nil。
    static func parse(_ data: Data) -> [RTCIceServer]? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let arr = root["iceServers"] as? [[String: Any]] else { return nil }
        var out: [RTCIceServer] = []
        for o in arr {
            var urls: [String] = []
            if let u = o["urls"] as? String { urls = [u] } else if let u = o["urls"] as? [String] { urls = u }
            if urls.isEmpty { continue }
            let user = (o["username"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let cred = (o["credential"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            out.append(user != nil && cred != nil ? RTCIceServer(urlStrings: urls, username: user, credential: cred) : RTCIceServer(urlStrings: urls))
        }
        return out.isEmpty ? nil : out
    }
}
