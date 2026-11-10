package app.pochitalk.rtc

import app.pochitalk.core.toHex
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.RtpTransceiver
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import java.security.SecureRandom
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Trystero 0.25.4 の peer.ts の移植 (ブラウザ標準の WebRTC を使う「Perfect Negotiation」方式)。
 *  - ICE 候補は少しずつ送る (trickle)。オファー/アンサーは候補を待たずに出す。
 *    候補は {type:"candidate", sdp: JSON.stringify({candidate, sdpMid, sdpMLineIndex, usernameFragment})} の形で渡す。
 *  - イニシエータだけがデータチャネル "data" を作り、相手は ondatachannel で受ける。
 *  - 再ネゴシエーション (音声トラックの追加など) はどちらからでも始められる。
 *    オファーがぶつかったら、イニシエータは相手のオファーを無視し、ノンイニシエータは巻き戻して受ける。
 *  - 切断の検知: failed / closed はすぐ、disconnected は5秒続いたら close とみなす。
 *
 * すべてのメソッドは Runtime.scope (単一スレッド) 上から呼ぶこと。
 */
class RtcPeer(
    private val factory: PeerConnectionFactory,
    iceServers: List<PeerConnection.IceServer>,
    val initiator: Boolean,
    private val scope: CoroutineScope = Runtime.scope,
    private val log: (String) -> Unit = Runtime::log,
) {
    enum class Health { LIVE, TRANSIENT, STALE }

    val id: String = ByteArray(4).also { SecureRandom().nextBytes(it) }.toHex().take(7)
    val created: Long = System.currentTimeMillis()

    var isDead = false
        private set

    /** 最初のオファー (イニシエータのみ)。 */
    val offer = CompletableDeferred<String>()

    // ---- ハンドラ (signal は、設定されるまで溜めておく)
    var onConnect: (() -> Unit)? = null
    var onClose: (() -> Unit)? = null

    /** 相手の音声トラック (届いたら、または設定した時点ですでに届いていたら呼ぶ)。 */
    var remoteAudio: org.webrtc.AudioTrack? = null
        private set
    var onRemoteAudio: ((org.webrtc.AudioTrack) -> Unit)? = null
        set(v) {
            field = v
            remoteAudio?.let { v?.invoke(it) }
        }
    var onError: ((String) -> Unit)? = null
    private var signalHandler: ((type: String, sdp: String) -> Unit)? = null
    private val pendingSignals = ArrayList<Pair<String, String>>()
    private var dataHandler: ((ByteArray) -> Unit)? = null
    private val pendingData = ArrayList<ByteArray>()

    private var pc: PeerConnection? = null
    private var channel: DataChannel? = null
    private var connectFired = false
    private var didEmitClose = false
    private var makingOffer = false
    private var settingRemoteAnswer = false
    private var disconnectJob: Job? = null
    private val senders = HashMap<MediaStreamTrack, RtpSender>()

    private class RemoteCandidate(val mid: String, val index: Int, val sdp: String, val ufrag: String?)

    private val pendingRemoteCandidates = ArrayList<RemoteCandidate>()

    private fun post(block: () -> Unit) {
        scope.launch { block() }
    }

    private val pcObserver = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState) {
            log("[$id] signaling $state")
        }
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            post {
                log("[$id] ice $state")
                handleConnectionStateChange()
            }
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            post {
                log("[$id] pc $state")
                handleConnectionStateChange()
            }
        }

        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
            log("[$id] gathering $state")
        }

        override fun onIceCandidate(candidate: IceCandidate) {
            val ufrag = Regex(" ufrag (\\S+)").find(candidate.sdp)?.groupValues?.get(1)
            val json = JSONObject()
                .put("candidate", candidate.sdp)
                .put("sdpMid", candidate.sdpMid)
                .put("sdpMLineIndex", candidate.sdpMLineIndex)
            if (ufrag != null) json.put("usernameFragment", ufrag)
            post { emitSignal("candidate", json.toString()) }
        }

        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onRenegotiationNeeded() {
            scope.launch { negotiate() }
        }

        override fun onDataChannel(dc: DataChannel) {
            post { setupData(dc) }
        }

        override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) {
            // 受信した音声トラックは libwebrtc が自動で再生する。モールス/FAX の復号のために、トラックも渡す。
            val t = receiver.track() as? org.webrtc.AudioTrack ?: return
            post {
                remoteAudio = t
                onRemoteAudio?.invoke(t)
            }
        }
    }

    init {
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // TURN の資格情報が取れていれば、中継のみ（家の無線LANで、直接の経路が通らず、つながるのが遅くなるため）。取れなければ STUN で直接
            val useRelay = iceServers.any { s -> s.urls.any { it.startsWith("turn:") || it.startsWith("turns:") } }
            iceTransportsType = if (useRelay) PeerConnection.IceTransportsType.RELAY else PeerConnection.IceTransportsType.ALL
        }
        pc = factory.createPeerConnection(config, pcObserver)
        if (pc == null) {
            post { destroy("createPeerConnection failed") }
        } else if (initiator) {
            val dc = pc!!.createDataChannel("data", DataChannel.Init())
            if (dc != null) setupData(dc) else post { destroy("createDataChannel failed") }
            // peer.ts と同じく、最初のオファーを自分で起こす
            scope.launch {
                if (!makingOffer && pc?.signalingState() == PeerConnection.SignalingState.STABLE && pc?.localDescription == null) {
                    negotiate()
                }
            }
        }
    }

    // ------------------------------------------------------------------ 公開API

    /** signal ハンドラを差し替える。それまでに溜まった signal はすぐ渡す。 */
    fun setSignalHandler(handler: ((type: String, sdp: String) -> Unit)?) {
        signalHandler = handler
        if (handler != null && pendingSignals.isNotEmpty()) {
            val buffered = ArrayList(pendingSignals)
            pendingSignals.clear()
            buffered.forEach { (t, s) -> handler(t, s) }
        }
    }

    /** データ受信ハンドラを登録し、それまでに届いていたデータを流し込む。 */
    fun setDataHandler(handler: (ByteArray) -> Unit) {
        dataHandler = handler
        val buffered = ArrayList(pendingData)
        pendingData.clear()
        buffered.forEach(handler)
    }

    fun send(bytes: ByteArray) {
        val dc = channel ?: return
        if (isDead) return
        try {
            dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), true))
        } catch (e: Exception) {
            log("[$id] send failed: ${e.message}")
        }
    }

    fun health(): Health {
        if (isDead) return Health.STALE
        val conn = pc ?: return Health.STALE
        val cs = conn.connectionState()
        val ics = conn.iceConnectionState()
        val ch = channel
        val chs = ch?.state()
        if (cs == PeerConnection.PeerConnectionState.CLOSED || cs == PeerConnection.PeerConnectionState.FAILED ||
            ics == PeerConnection.IceConnectionState.CLOSED || ics == PeerConnection.IceConnectionState.FAILED ||
            chs == DataChannel.State.CLOSING || chs == DataChannel.State.CLOSED
        ) return Health.STALE
        if (ch == null || chs != DataChannel.State.OPEN) return Health.TRANSIENT
        return Health.LIVE
    }

    /**
     * 音声が通っていない相手か (Web版の audioStuck)。つながっていない、または送信用トランシーバの
     * 音声の取り決め (currentDirection) が決まらないままなら true。
     */
    fun audioStuck(): Boolean = try {
        val conn = pc
        if (conn == null || conn.connectionState() != PeerConnection.PeerConnectionState.CONNECTED) true
        else conn.transceivers.any { t ->
            t.sender.track() != null &&
                (t.direction == RtpTransceiver.RtpTransceiverDirection.SEND_RECV || t.direction == RtpTransceiver.RtpTransceiverDirection.SEND_ONLY) &&
                t.currentDirection == null
        }
    } catch (_: Throwable) {
        false
    }

    /** 相手から届いた signal (オファー / アンサー / 候補) を処理する。 */
    fun signal(type: String, sdp: String) {
        if (isDead) return
        scope.launch { handleSignal(type, sdp) }
    }

    /** 自分の音声トラックを相手に流す (Trystero の room.addStream 相当)。 */
    fun addTrack(track: MediaStreamTrack, streamId: String) {
        if (isDead) return
        val conn = pc ?: return
        if (senders.containsKey(track)) return
        val sender = conn.addTrack(track, listOf(streamId))
        if (sender == null) {
            log("[$id] addTrack failed")
            return
        }
        senders[track] = sender
        log("[$id] audio track added")
        // 再ネゴシエーションは onRenegotiationNeeded で始まる
    }

    /**
     * 受信中の音声の大きさ (0..1 の線形値) を libwebrtc の統計から取る。
     * Web版の AnalyserNode による RX レベルに相当。取れなければ null。
     */
    fun fetchInboundAudioLevel(callback: (Double?) -> Unit) {
        val conn = pc
        if (conn == null || isDead) {
            callback(null)
            return
        }
        conn.getStats { report ->
            var level: Double? = null
            for (stat in report.statsMap.values) {
                if (stat.type == "inbound-rtp") {
                    val v = stat.members["audioLevel"]
                    if (v is Double) level = maxOf(level ?: 0.0, v)
                }
            }
            scope.launch { callback(level) }
        }
    }

    fun destroy(reason: String? = null) {
        if (isDead) return
        isDead = true
        log("[$id] destroying${if (reason != null) " ($reason)" else ""}")
        disconnectJob?.cancel()
        try {
            channel?.unregisterObserver()
            channel?.close()
            channel?.dispose()
        } catch (_: Exception) {
        }
        try {
            pc?.close()
            pc?.dispose()
        } catch (_: Exception) {
        }
        pc = null
        channel = null
        makingOffer = false
        settingRemoteAnswer = false
        emitClose()
    }

    // ------------------------------------------------------------------ 内部

    private fun emitClose() {
        if (didEmitClose) return
        didEmitClose = true
        disconnectJob?.cancel()
        onClose?.invoke()
    }

    private fun emitSignal(type: String, sdp: String) {
        if (type == "offer" && !offer.isCompleted) offer.complete(sdp)
        val h = signalHandler
        if (h != null) h(type, sdp) else pendingSignals.add(type to sdp)
    }

    private fun handleConnectionStateChange() {
        val conn = pc ?: return
        val cs = conn.connectionState()
        val ics = conn.iceConnectionState()
        if (cs == PeerConnection.PeerConnectionState.FAILED || cs == PeerConnection.PeerConnectionState.CLOSED ||
            ics == PeerConnection.IceConnectionState.FAILED || ics == PeerConnection.IceConnectionState.CLOSED
        ) {
            emitClose()
            return
        }
        if (cs == PeerConnection.PeerConnectionState.CONNECTED || cs == PeerConnection.PeerConnectionState.CONNECTING ||
            ics == PeerConnection.IceConnectionState.CONNECTED || ics == PeerConnection.IceConnectionState.COMPLETED ||
            ics == PeerConnection.IceConnectionState.CHECKING
        ) {
            disconnectJob?.cancel()
            disconnectJob = null
            return
        }
        if (cs == PeerConnection.PeerConnectionState.DISCONNECTED || ics == PeerConnection.IceConnectionState.DISCONNECTED) {
            if (disconnectJob == null) {
                disconnectJob = scope.launch {
                    delay(DISCONNECTED_CLOSE_DELAY_MS)
                    disconnectJob = null
                    val c = pc ?: return@launch
                    if (c.connectionState() == PeerConnection.PeerConnectionState.DISCONNECTED ||
                        c.iceConnectionState() == PeerConnection.IceConnectionState.DISCONNECTED
                    ) emitClose()
                }
            }
        }
    }

    private fun setupData(dc: DataChannel) {
        if (channel != null && channel !== dc) {
            log("[$id] extra data channel ignored")
            return
        }
        channel = dc
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}

            override fun onStateChange() {
                post {
                    when (dc.state()) {
                        DataChannel.State.OPEN -> fireConnect()
                        DataChannel.State.CLOSED -> emitClose()
                        else -> {}
                    }
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                post {
                    val h = dataHandler
                    if (h != null) h(bytes) else pendingData.add(bytes)
                }
            }
        })
        if (dc.state() == DataChannel.State.OPEN) post { fireConnect() }
    }

    private fun fireConnect() {
        if (connectFired || isDead) return
        connectFired = true
        log("[$id] data channel open")
        onConnect?.invoke()
    }

    // ------------------------------------------------------------------ ネゴシエーション (Perfect Negotiation)

    private suspend fun negotiate() {
        val conn = pc ?: return
        if (isDead || makingOffer) return
        if (conn.signalingState() != PeerConnection.SignalingState.STABLE) return
        try {
            makingOffer = true
            val offerDesc = createSdp(conn, offer = true)
            setLocal(conn, offerDesc)
            emitLocalDescription(conn)
        } catch (e: Exception) {
            if (!isDead) {
                log("[$id] failed to create local offer: ${e.message}")
                onError?.invoke("failed to create local offer: ${e.message}")
            }
        } finally {
            makingOffer = false
        }
    }

    private fun emitLocalDescription(conn: PeerConnection) {
        val ld = conn.localDescription ?: return
        emitSignal(ld.type.canonicalForm(), ld.description)
    }

    private fun remoteUfrag(conn: PeerConnection): String? {
        val sdp = conn.remoteDescription?.description ?: return null
        return Regex("a=ice-ufrag:(\\S+)").find(sdp)?.groupValues?.get(1)
    }

    private fun canApplyRemoteCandidate(conn: PeerConnection, c: RemoteCandidate): Boolean {
        val remote = conn.remoteDescription ?: return false
        val mLines = Regex("^m=", RegexOption.MULTILINE).findAll(remote.description).count()
        if (c.index >= 0 && mLines > 0 && c.index >= mLines) return false
        val ufrag = remoteUfrag(conn)
        if (ufrag != null && c.ufrag != null && c.ufrag != ufrag) return false
        return true
    }

    private fun applyRemoteCandidate(conn: PeerConnection, c: RemoteCandidate): Boolean =
        try {
            conn.addIceCandidate(IceCandidate(c.mid, c.index, c.sdp))
        } catch (e: Exception) {
            false
        }

    private fun addRemoteCandidate(c: RemoteCandidate) {
        val conn = pc ?: return
        if (canApplyRemoteCandidate(conn, c)) {
            if (!applyRemoteCandidate(conn, c)) pendingRemoteCandidates.add(c)
            return
        }
        pendingRemoteCandidates.add(c)
    }


    private fun flushPendingRemoteCandidates() {
        val conn = pc ?: return
        if (conn.remoteDescription == null || pendingRemoteCandidates.isEmpty()) return
        val queued = ArrayList(pendingRemoteCandidates)
        pendingRemoteCandidates.clear()
        for (c in queued) {
            if (!canApplyRemoteCandidate(conn, c) || !applyRemoteCandidate(conn, c)) pendingRemoteCandidates.add(c)
        }
    }

    private suspend fun handleSignal(type: String, sdp: String) {
        val conn = pc ?: return
        if (isDead) return
        try {
            if (type == "candidate") {
                val j = JSONObject(sdp)
                val cand = j.optString("candidate", "")
                if (cand.isNotEmpty()) {
                    addRemoteCandidate(
                        RemoteCandidate(
                            mid = if (j.isNull("sdpMid")) "" else j.optString("sdpMid", ""),
                            index = j.optInt("sdpMLineIndex", -1),
                            sdp = cand,
                            ufrag = j.optString("usernameFragment", "").ifEmpty { null },
                        ),
                    )
                }
                return
            }
            // 音声の無い (データチャネルだけの) やり直しは、接続済みなら無視する
            if (channel?.state() == DataChannel.State.OPEN && !sdp.contains("a=rtpmap")) return
            if (type == "offer") {
                val remote = SessionDescription(SessionDescription.Type.OFFER, sdp)
                val collision = makingOffer ||
                    (conn.signalingState() != PeerConnection.SignalingState.STABLE && !settingRemoteAnswer)
                if (collision) {
                    if (initiator) return // こちらのオファーを優先する
                    setLocal(conn, SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                    setRemote(conn, remote)
                } else {
                    setRemote(conn, remote)
                }
                flushPendingRemoteCandidates()
                log("[$id] remote offer set (collision=$collision), creating answer")
                val answer = createSdp(conn, offer = false)
                setLocal(conn, answer)
                log("[$id] local answer set")
                emitLocalDescription(conn)
            } else if (type == "answer") {
                settingRemoteAnswer = true
                try {
                    setRemote(conn, SessionDescription(SessionDescription.Type.ANSWER, sdp))
                    flushPendingRemoteCandidates()
                } finally {
                    settingRemoteAnswer = false
                }
            }
        } catch (e: Exception) {
            if (!isDead) {
                log("[$id] failed to apply remote signal ($type): ${e.message}")
                onError?.invoke("failed to apply remote signal: ${e.message}")
            }
        }
    }

    private suspend fun createSdp(conn: PeerConnection, offer: Boolean): SessionDescription =
        suspendCancellableCoroutine { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) {
                    if (cont.isActive) cont.resume(sdp)
                }

                override fun onCreateFailure(error: String) {
                    if (cont.isActive) cont.resumeWithException(IllegalStateException(error))
                }

                override fun onSetSuccess() {}
                override fun onSetFailure(error: String) {}
            }
            if (offer) conn.createOffer(obs, MediaConstraints()) else conn.createAnswer(obs, MediaConstraints())
        }

    private suspend fun setLocal(conn: PeerConnection, desc: SessionDescription) = setDescription(desc, conn, local = true)

    private suspend fun setRemote(conn: PeerConnection, desc: SessionDescription) = setDescription(desc, conn, local = false)

    private suspend fun setDescription(desc: SessionDescription, conn: PeerConnection, local: Boolean) =
        suspendCancellableCoroutine<Unit> { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) {}
                override fun onCreateFailure(error: String) {}
                override fun onSetSuccess() {
                    if (cont.isActive) cont.resume(Unit)
                }

                override fun onSetFailure(error: String) {
                    if (cont.isActive) cont.resumeWithException(IllegalStateException(error))
                }
            }
            if (local) conn.setLocalDescription(obs, desc) else conn.setRemoteDescription(obs, desc)
        }

    companion object {
        private const val DISCONNECTED_CLOSE_DELAY_MS = 5_000L
    }
}
