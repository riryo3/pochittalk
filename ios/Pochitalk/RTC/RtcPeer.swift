import Foundation
import WebRTC

/// Trystero 0.25.4 の peer.ts の移植 (ブラウザ標準の WebRTC を使う「Perfect Negotiation」方式。Android 版 RtcPeer.kt と同じ形)。
///  - ICE 候補は少しずつ送る (trickle)。オファー/アンサーは候補を待たずに出す。
///    候補は {type:"candidate", sdp: JSON.stringify({candidate, sdpMid, sdpMLineIndex, usernameFragment})} の形で渡す。
///  - イニシエータだけがデータチャネル "data" を作り、相手は didOpen で受ける。
///  - 再ネゴシエーション (音声トラックの追加など) はどちらからでも始められる。
///    オファーがぶつかったら、イニシエータは相手のオファーを無視し、ノンイニシエータは巻き戻して受ける。
///  - 切断の検知: failed / closed はすぐ、disconnected は5秒続いたら close とみなす。
/// すべてのメソッドは RT.queue 上から呼ぶこと。
final class RtcPeer: NSObject, RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    enum Health { case live, transient, stale }

    let id: String
    let initiator: Bool
    private(set) var isDead = false

    /// 最初のオファー (イニシエータのみ)。待っている人たちに一度だけ渡す。
    private var firstOffer: String?
    private var offerWaiters: [(String?) -> Void] = []

    var onConnect: (() -> Void)?
    var onClose: (() -> Void)?
    var onError: ((String) -> Void)?
    private var signalHandler: ((String, String) -> Void)?
    private var pendingSignals: [(String, String)] = []
    private var dataHandler: ((Data) -> Void)?
    private var pendingData: [Data] = []

    private var pc: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var connectFired = false
    private var didEmitClose = false
    private var makingOffer = false
    private var settingRemoteAnswer = false
    private var disconnectJob: Job?
    private var senders: [ObjectIdentifier: RTCRtpSender] = [:]

    private struct RemoteCandidate {
        let mid: String
        let index: Int32
        let sdp: String
        let ufrag: String?
    }
    private var pendingRemoteCandidates: [RemoteCandidate] = []

    init(factory: RTCPeerConnectionFactory, iceServers: [RTCIceServer], initiator: Bool) {
        self.id = String(UUID().uuidString.prefix(7)).lowercased()
        self.initiator = initiator
        super.init()
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        // TURN の資格情報が取れていれば、中継のみ（家の無線LANで、直接の経路が通らず、つながるのが遅くなるため）。取れなければ STUN で直接
        let useRelay = iceServers.contains { $0.urlStrings.contains { $0.hasPrefix("turn:") || $0.hasPrefix("turns:") } }
        config.iceTransportPolicy = useRelay ? .relay : .all
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = factory.peerConnection(with: config, constraints: constraints, delegate: self)
        if pc == nil {
            RT.post { self.destroy("createPeerConnection failed") }
        } else if initiator {
            if let dc = pc?.dataChannel(forLabel: "data", configuration: RTCDataChannelConfiguration()) {
                setupData(dc)
            } else {
                RT.post { self.destroy("createDataChannel failed") }
            }
            // peer.ts と同じく、最初のオファーを自分で起こす
            RT.post { [weak self] in
                guard let self, !self.makingOffer, self.pc?.signalingState == .stable, self.pc?.localDescription == nil else { return }
                self.negotiate()
            }
        }
    }

    // ------------------------------------------------------------------ 公開API

    /// 最初のオファーができたら呼ぶ (できなければ nil)。すでにあればすぐ。
    func awaitOffer(_ done: @escaping (String?) -> Void) {
        if let o = firstOffer { done(o); return }
        if isDead { done(nil); return }
        offerWaiters.append(done)
    }

    func setSignalHandler(_ handler: ((String, String) -> Void)?) {
        signalHandler = handler
        if let h = handler, !pendingSignals.isEmpty {
            let buffered = pendingSignals
            pendingSignals = []
            for (t, s) in buffered { h(t, s) }
        }
    }

    func setDataHandler(_ handler: @escaping (Data) -> Void) {
        dataHandler = handler
        let buffered = pendingData
        pendingData = []
        buffered.forEach(handler)
    }

    func send(_ bytes: Data) {
        guard let dc = channel, !isDead else { return }
        if !dc.sendData(RTCDataBuffer(data: bytes, isBinary: true)) {
            RT.log("[\(id)] send failed")
        }
    }

    func health() -> Health {
        guard !isDead, let conn = pc else { return .stale }
        let cs = conn.connectionState, ics = conn.iceConnectionState
        let chs = channel?.readyState
        if cs == .closed || cs == .failed || ics == .closed || ics == .failed || chs == .closing || chs == .closed { return .stale }
        if channel == nil || chs != .open { return .transient }
        return .live
    }

    /// 音声が通る相手か。つながっていても、音声の取り決めが外れている (送るトラックがあるのに向きが決まらない) 相手は数えない (Web 版 audioStuck の逆)。
    func audioOK() -> Bool {
        guard !isDead, let conn = pc, conn.connectionState == .connected else { return false }
        for t in conn.transceivers {
            guard t.sender.track != nil, t.direction == .sendRecv || t.direction == .sendOnly else { continue }
            var cur = RTCRtpTransceiverDirection.inactive
            if !t.currentDirection(&cur) { return false } // currentDirection が null のまま
        }
        return true
    }

    func signal(_ type: String, _ sdp: String) {
        guard !isDead else { return }
        RT.post { [weak self] in self?.handleSignal(type, sdp) }
    }

    /// 自分の音声トラックを相手に流す (Trystero の room.addStream 相当)。
    func addTrack(_ track: RTCMediaStreamTrack, streamId: String) {
        guard !isDead, let conn = pc else { return }
        let key = ObjectIdentifier(track)
        if senders[key] != nil { return }
        guard let sender = conn.add(track, streamIds: [streamId]) else {
            RT.log("[\(id)] addTrack failed")
            return
        }
        senders[key] = sender
        RT.log("[\(id)] audio track added")
        // 再ネゴシエーションは peerConnectionShouldNegotiate で始まる
    }

    /// 受信中の音声の大きさ (0..1 の線形値)。取れなければ nil。
    func fetchInboundAudioLevel(_ callback: @escaping (Double?) -> Void) {
        guard let conn = pc, !isDead else { callback(nil); return }
        conn.statistics { report in
            var level: Double?
            for stat in report.statistics.values where stat.type == "inbound-rtp" {
                if let v = (stat.values["audioLevel"] as? NSNumber)?.doubleValue { level = max(level ?? 0, v) }
            }
            RT.post { callback(level) }
        }
    }

    func destroy(_ reason: String? = nil) {
        guard !isDead else { return }
        isDead = true
        RT.log("[\(id)] destroying\(reason.map { " (\($0))" } ?? "")")
        disconnectJob?.cancel()
        channel?.delegate = nil
        channel?.close()
        pc?.close()
        pc = nil
        channel = nil
        makingOffer = false
        settingRemoteAnswer = false
        let waiters = offerWaiters
        offerWaiters = []
        waiters.forEach { $0(nil) }
        emitClose()
    }

    // ------------------------------------------------------------------ 内部

    private func emitClose() {
        if didEmitClose { return }
        didEmitClose = true
        disconnectJob?.cancel()
        onClose?()
    }

    private func emitSignal(_ type: String, _ sdp: String) {
        if type == "offer", firstOffer == nil {
            firstOffer = sdp
            let w = offerWaiters
            offerWaiters = []
            w.forEach { $0(sdp) }
        }
        if let h = signalHandler { h(type, sdp) } else { pendingSignals.append((type, sdp)) }
    }

    private func handleConnectionStateChange() {
        guard let conn = pc else { return }
        let cs = conn.connectionState, ics = conn.iceConnectionState
        if cs == .failed || cs == .closed || ics == .failed || ics == .closed {
            emitClose()
            return
        }
        if cs == .connected || cs == .connecting || ics == .connected || ics == .completed || ics == .checking {
            disconnectJob?.cancel()
            disconnectJob = nil
            return
        }
        if cs == .disconnected || ics == .disconnected {
            if disconnectJob == nil {
                disconnectJob = RT.after(5_000) { [weak self] in
                    guard let self else { return }
                    self.disconnectJob = nil
                    guard let c = self.pc else { return }
                    if c.connectionState == .disconnected || c.iceConnectionState == .disconnected { self.emitClose() }
                }
            }
        }
    }

    private func setupData(_ dc: RTCDataChannel) {
        if channel != nil && channel !== dc {
            RT.log("[\(id)] extra data channel ignored")
            return
        }
        channel = dc
        dc.delegate = self
        if dc.readyState == .open { RT.post { self.fireConnect() } }
    }

    private func fireConnect() {
        if connectFired || isDead { return }
        connectFired = true
        RT.log("[\(id)] data channel open")
        onConnect?()
    }

    // ------------------------------------------------------------------ ネゴシエーション (Perfect Negotiation)

    private func negotiate() {
        guard let conn = pc, !isDead, !makingOffer, conn.signalingState == .stable else { return }
        makingOffer = true
        let c = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        conn.offer(for: c) { [weak self] sdp, err in
            RT.post {
                guard let self else { return }
                guard let sdp, err == nil else { return self.offerFailed(err?.localizedDescription ?? "no sdp") }
                // オファーを作っている間に、相手のオファーを受けた (状態が変わった) ときは、このオファーは捨てる。
                // 相手のオファーに答えたあと、必要ならもう一度 peerConnectionShouldNegotiate が来る (Perfect Negotiation)。
                guard self.pc?.signalingState == .stable else {
                    self.makingOffer = false
                    RT.log("[\(self.id)] local offer dropped (state changed)")
                    return
                }
                self.pc?.setLocalDescription(sdp) { err in
                    RT.post {
                        self.makingOffer = false
                        if let err {
                            // 設定の直前に相手のオファーが入ったときも、ここに来る。壊さずに、捨てる
                            if self.pc?.signalingState != .stable { RT.log("[\(self.id)] local offer dropped: \(err.localizedDescription)"); return }
                            return self.offerFailed(err.localizedDescription)
                        }
                        self.emitLocalDescription()
                    }
                }
            }
        }
    }

    private func offerFailed(_ msg: String) {
        makingOffer = false
        if !isDead {
            RT.log("[\(id)] failed to create local offer: \(msg)")
            onError?("failed to create local offer: \(msg)")
        }
    }

    private func emitLocalDescription() {
        guard let ld = pc?.localDescription else { return }
        emitSignal(RTCSessionDescription.string(for: ld.type), ld.sdp)
    }

    private func remoteUfrag(_ conn: RTCPeerConnection) -> String? {
        guard let sdp = conn.remoteDescription?.sdp, let r = sdp.range(of: "a=ice-ufrag:") else { return nil }
        return String(sdp[r.upperBound...].prefix { !$0.isWhitespace })
    }

    private func canApplyRemoteCandidate(_ conn: RTCPeerConnection, _ c: RemoteCandidate) -> Bool {
        guard let remote = conn.remoteDescription else { return false }
        let mLines = Sdp.mediaSectionCount(remote.sdp)
        if c.index >= 0 && mLines > 0 && Int(c.index) >= mLines { return false }
        if let ufrag = remoteUfrag(conn), let cu = c.ufrag, cu != ufrag { return false }
        return true
    }

    private func applyRemoteCandidate(_ conn: RTCPeerConnection, _ c: RemoteCandidate) {
        let cand = RTCIceCandidate(sdp: c.sdp, sdpMLineIndex: c.index, sdpMid: c.mid.isEmpty ? nil : c.mid)
        conn.add(cand) { [weak self] err in
            if let err { RT.log("[\(self?.id ?? "?")] addIceCandidate failed: \(err.localizedDescription)") }
        }
    }

    private func addRemoteCandidate(_ c: RemoteCandidate) {
        guard let conn = pc else { return }
        if canApplyRemoteCandidate(conn, c) { applyRemoteCandidate(conn, c) } else { pendingRemoteCandidates.append(c) }
    }

    private func flushPendingRemoteCandidates() {
        guard let conn = pc, conn.remoteDescription != nil, !pendingRemoteCandidates.isEmpty else { return }
        let queued = pendingRemoteCandidates
        pendingRemoteCandidates = []
        for c in queued {
            if canApplyRemoteCandidate(conn, c) { applyRemoteCandidate(conn, c) } else { pendingRemoteCandidates.append(c) }
        }
    }

    private func handleSignal(_ type: String, _ sdp: String) {
        guard let conn = pc, !isDead else { return }
        if type == "candidate" {
            guard let j = JSON.object(sdp), let cand = j["candidate"] as? String, !cand.isEmpty else { return }
            addRemoteCandidate(RemoteCandidate(
                mid: (j["sdpMid"] as? String) ?? "",
                index: Int32((j["sdpMLineIndex"] as? Int) ?? -1),
                sdp: cand,
                ufrag: (j["usernameFragment"] as? String).flatMap { $0.isEmpty ? nil : $0 }))
            return
        }
        // 音声の無い (データチャネルだけの) やり直しは、接続済みなら無視する
        if channel?.readyState == .open && !sdp.contains("a=rtpmap") { return }
        if type == "offer" {
            let remote = RTCSessionDescription(type: .offer, sdp: sdp)
            let collision = makingOffer || (conn.signalingState != .stable && !settingRemoteAnswer)
            if collision {
                if initiator { return } // こちらのオファーを優先する
                // こちらのオファーが設定済み (have-local-offer) のときだけ、巻き戻す。まだ設定前なら、そのまま相手のオファーを受ける
                if conn.signalingState == .haveLocalOffer {
                    conn.setLocalDescription(RTCSessionDescription(type: .rollback, sdp: "")) { [weak self] err in
                        RT.post {
                            if let err { return self?.signalFailed("offer", err) ?? () }
                            self?.applyRemoteOffer(remote, collision: true)
                        }
                    }
                } else {
                    applyRemoteOffer(remote, collision: true)
                }
            } else {
                applyRemoteOffer(remote, collision: false)
            }
        } else if type == "answer" {
            settingRemoteAnswer = true
            conn.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] err in
                RT.post {
                    self?.settingRemoteAnswer = false
                    if let err { return self?.signalFailed("answer", err) ?? () }
                    self?.flushPendingRemoteCandidates()
                }
            }
        }
    }

    private func applyRemoteOffer(_ remote: RTCSessionDescription, collision: Bool) {
        guard let conn = pc, !isDead else { return }
        conn.setRemoteDescription(remote) { [weak self] err in
            RT.post {
                guard let self, let conn = self.pc else { return }
                if let err { return self.signalFailed("offer", err) }
                self.flushPendingRemoteCandidates()
                RT.log("[\(self.id)] remote offer set (collision=\(collision)), creating answer")
                conn.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { sdp, err in
                    RT.post {
                        guard let sdp, err == nil else { return self.signalFailed("offer", err ?? NSError(domain: "rtc", code: 1)) }
                        self.pc?.setLocalDescription(sdp) { err in
                            RT.post {
                                if let err { return self.signalFailed("offer", err) }
                                RT.log("[\(self.id)] local answer set")
                                self.emitLocalDescription()
                            }
                        }
                    }
                }
            }
        }
    }

    private func signalFailed(_ type: String, _ err: Error) {
        if !isDead {
            RT.log("[\(id)] failed to apply remote signal (\(type)): \(err.localizedDescription)")
            onError?("failed to apply remote signal: \(err.localizedDescription)")
        }
    }

    // ------------------------------------------------------------------ RTCPeerConnectionDelegate

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {
        RT.log("[\(id)] signaling \(stateChanged.rawValue)")
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) { RT.post { self.negotiate() } }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        RT.post { RT.log("[\(self.id)] ice \(newState.rawValue)"); self.handleConnectionStateChange() }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        RT.post { RT.log("[\(self.id)] pc \(newState.rawValue)"); self.handleConnectionStateChange() }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        var ufrag: String?
        if let r = candidate.sdp.range(of: " ufrag ") { ufrag = String(candidate.sdp[r.upperBound...].prefix { !$0.isWhitespace }) }
        var j: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": Int(candidate.sdpMLineIndex)]
        j["sdpMid"] = candidate.sdpMid ?? NSNull()
        if let ufrag { j["usernameFragment"] = ufrag }
        let text = JSON.string(j)
        RT.post { self.emitSignal("candidate", text) }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        RT.post { self.setupData(dataChannel) }
    }

    // ------------------------------------------------------------------ RTCDataChannelDelegate

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        RT.post {
            switch dataChannel.readyState {
            case .open: self.fireConnect()
            case .closed: self.emitClose()
            default: break
            }
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let bytes = buffer.data
        RT.post {
            if let h = self.dataHandler { h(bytes) } else { self.pendingData.append(bytes) }
        }
    }
}
