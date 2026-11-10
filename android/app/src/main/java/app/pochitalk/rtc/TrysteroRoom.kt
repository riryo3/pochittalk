package app.pochitalk.rtc

import app.pochitalk.core.ActionCodec
import app.pochitalk.core.TrysteroCrypto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import org.webrtc.MediaStreamTrack
import javax.crypto.spec.SecretKeySpec

/**
 * Trystero 0.25.4 の strategy.ts + signal-handler.ts (相手探しとオファー/アンサー/候補の交換)、
 * shared-peer.ts (部屋トークン付きフレーム)、handshake.ts (接続後の確認)、room.ts / actions.ts (アクション)
 * を、このアプリに必要な範囲で移植したもの。呼び出しはすべて Runtime.scope 上で行うこと。
 *
 * 通信の形 (Web版と同じ):
 *  1. 部屋ごとの rootTopic = sha1("Trystero@appId@roomId") と、自分宛の selfTopic = sha1(root@selfId) を購読する。
 *     イベントの kind は topic ごとに違う (NostrProtocol.topicToKind)。
 *  2. rootTopic に {"peerId": selfId} を投稿 (announce)。0.23s, 0.5s, 1.3s のあと60秒おき。
 *  3. announce を見たとき、selfId が小さい側がオファーを作って相手の selfTopic へ送る。
 *     大きい側は、自分の announce を相手の selfTopic へ返して、オファーを待つ。
 *  4. オファー/アンサー/候補は AES-GCM で暗号化した文字列。 {peerId, offerId, offer|answer|candidate}
 *  5. データチャネルが開いたら、部屋トークン付きのフレームで @_hsready を送り合い、両方そろったら入室扱いにする。
 */
class TrysteroRoom internal constructor(
    val appId: String,
    val roomId: String,
    private val net: TrysteroNetwork,
) {
    private val selfId = net.selfId
    private val rootTopicPlain = TrysteroCrypto.topicPath("Trystero", appId, roomId)
    private val rootTopic = TrysteroCrypto.sha1Topic(rootTopicPlain)
    private val selfTopic = TrysteroCrypto.sha1Topic(TrysteroCrypto.topicPath(rootTopicPlain, selfId))
    private val key: SecretKeySpec = TrysteroCrypto.genKey("", appId, roomId)
    private val roomToken = TrysteroCrypto.deriveRoomNamespace(appId, roomId)

    private var left = false
    private val subIds = ArrayList<Pair<Int, String>>()
    private val announceJobs = ArrayList<Job>()

    // ---- 相手ごとの接続状態 (signal-handler.ts の PeerState)
    private class OfferInfo(val peer: RtcPeer, val id: String, val cipher: String)

    private class PState {
        var connected: RtcPeer? = null
        var unhealthySince = 0L
        var offerPeer: RtcPeer? = null
        var offerInfo: OfferInfo? = null
        var offerInit: CompletableDeferred<OfferInfo?>? = null
        var offerAnswered = false
        val offerRelays = HashMap<Int, Job?>() // オファーを送った/送ろうとしているリレー (一定時間で外れる)
        val signalRelays = HashSet<Int>() // 候補を流し続けるリレー
        val offerBacklog = ArrayList<String>()
        var offerExpiry: Job? = null
        var answering: RtcPeer? = null
        var answerSent = false
        var answeringExpiry: Job? = null
        val pendingCandidates = HashMap<String, ArrayList<String>>()
    }

    private val states = HashMap<String, PState>()
    private fun state(peerId: String) = states.getOrPut(peerId) { PState() }

    // ---- 接続済みの相手 (room.ts の peerMap)
    private inner class Slot(val id: String, val peer: RtcPeer) {
        val reassembler = ActionCodec.Reassembler()
        var localPassed = false
        var remoteReady = false
        var active = false
        var timeout: Job? = null
    }

    private val slots = HashMap<String, Slot>()

    private class LocalTrack(val track: MediaStreamTrack, val streamId: String, val streamKey: String)

    private val localTracks = ArrayList<LocalTrack>()
    private val actions = HashMap<String, Action>()

    var onPeerJoin: ((peerId: String) -> Unit)? = null
    var onPeerLeave: ((peerId: String) -> Unit)? = null
    /** 相手の音声トラックが届いた (モールス/FAX の復号用)。 */
    var onRemoteAudio: ((peerId: String, track: org.webrtc.AudioTrack) -> Unit)? = null

    /** 入室扱いになった (確認が済んだ) 相手の id。 */
    val peerIds: Set<String> get() = slots.values.filter { it.active }.map { it.id }.toSet()

    /** 音声が通っている相手の数 (自分を含まない。Web版の goodLinkCount)。 */
    fun goodLinkCount(): Int = slots.values.count { it.active && !it.peer.audioStuck() }

    // ================================================================ アクション

    inner class Action(val type: String, val sendToPending: Boolean = false, val receiveWhilePending: Boolean = false) {
        private var nonce = 0
        var onMessage: ((msg: ActionCodec.Message, peerId: String) -> Unit)? = null

        fun sendString(text: String, to: String? = null) = send(ActionCodec.encodeString(type, text, nextNonce()), to)

        fun sendJson(json: JSONObject, to: String? = null) = send(ActionCodec.encodeJson(type, json, nextNonce()), to)

        private fun nextNonce(): Int {
            val n = nonce
            nonce = (nonce + 1) and 0xffff
            return n
        }

        private fun send(chunks: List<ByteArray>, to: String?) {
            val targets = if (to != null) listOfNotNull(slots[to]) else slots.values.toList()
            for (slot in targets) {
                if (!sendToPending && !slot.active) continue
                for (chunk in chunks) slot.peer.send(ActionCodec.wrapRoomFrame(roomToken, chunk))
            }
        }
    }

    /** アクションを登録する (同じ名前なら同じものを返す)。名前は32バイト以内。 */
    fun action(type: String): Action = actions.getOrPut(type) { Action(type) }

    private fun internalAction(type: String, sendToPending: Boolean = false, receiveWhilePending: Boolean = false) =
        actions.getOrPut(type) { Action(type, sendToPending, receiveWhilePending) }

    private val pingAction = internalAction("@_ping")
    private val pongAction = internalAction("@_pong")
    private val signalAction = internalAction("@_signal")
    private val streamMetaAction = internalAction("@_stream")
    private val trackMetaAction = internalAction("@_track")
    private val leaveAction = internalAction("@_leave", sendToPending = true, receiveWhilePending = true)
    private val hsDataAction = internalAction("@_hsdata", sendToPending = true, receiveWhilePending = true)
    private val hsReadyAction = internalAction("@_hsready", sendToPending = true, receiveWhilePending = true)

    init {
        pingAction.onMessage = { _, id -> pongAction.sendString("", id) }
        pongAction.onMessage = { _, _ -> }
        signalAction.onMessage = { msg, id ->
            val slot = slots[id]
            if (slot != null && slot.active && msg.isJson) {
                val j = msg.json()
                val t = j.optString("type", "")
                val s = j.optString("sdp", "")
                if (t.isNotEmpty() && s.isNotEmpty()) slot.peer.signal(t, s)
            }
        }
        streamMetaAction.onMessage = { _, _ -> } // 受け取った音声は libwebrtc が自動で再生する
        trackMetaAction.onMessage = { _, _ -> }
        hsDataAction.onMessage = { _, _ -> }
        hsReadyAction.onMessage = { _, id ->
            slots[id]?.let {
                it.remoteReady = true
                maybeActivate(it)
            }
        }
        leaveAction.onMessage = { _, id -> exitPeer(id, null) }
        start()
    }

    /** 指定した相手から受信中の音声レベル (0..1)。 */
    fun fetchInboundAudioLevel(peerId: String, callback: (Double?) -> Unit) {
        val slot = slots[peerId]
        if (slot == null) callback(null) else slot.peer.fetchInboundAudioLevel(callback)
    }

    /** 自分の音声トラックを共有する。すでに入室扱いの相手と、これから入る相手の両方に流す。 */
    fun addLocalTrack(track: MediaStreamTrack, streamId: String) {
        if (localTracks.none { it.track === track }) {
            localTracks.add(LocalTrack(track, streamId, TrysteroCrypto.genId(20)))
        }
        val lt = localTracks.first { it.track === track }
        slots.values.filter { it.active }.forEach { attachTrack(it, lt) }
    }

    private fun attachTrack(slot: Slot, lt: LocalTrack) {
        // ブラウザ側は、メタ情報 {k, s} を先に受け取ってから届いた音声を再生する
        streamMetaAction.sendJson(JSONObject().put("k", lt.streamKey).put("s", lt.streamId), slot.id)
        slot.peer.addTrack(lt.track, lt.streamId)
    }

    fun leave() {
        if (left) return
        left = true
        leaveAction.sendString("")
        Runtime.scope.launch {
            delay(99)
            slots.values.toList().forEach { it.peer.destroy("leave") }
            slots.clear()
            states.values.forEach { st ->
                st.offerExpiry?.cancel()
                st.answeringExpiry?.cancel()
                st.offerRelays.values.forEach { it?.cancel() }
                st.offerPeer?.destroy("leave")
                st.answering?.destroy("leave")
                st.connected?.destroy("leave")
            }
            states.clear()
            announceJobs.forEach { it.cancel() }
            announceJobs.clear()
            subIds.forEach { (i, subId) -> net.unsubscribe(i, subId) }
            subIds.clear()
            net.roomClosed(appId, roomId, this@TrysteroRoom)
        }
    }

    // ================================================================ 接続後 (room.ts / handshake.ts)

    private fun handleFrame(id: String, slot: Slot, bytes: ByteArray) {
        when (val frame = ActionCodec.unwrapFrame(bytes)) {
            null -> {}
            is ActionCodec.Frame.Presence -> {} // 部屋は1つしか使わないので、他の部屋の在室通知は不要
            is ActionCodec.Frame.Room -> {
                if (frame.roomToken != roomToken) return
                handleData(id, slot, frame.payload)
            }
        }
    }

    private fun handleData(id: String, slot: Slot, payload: ByteArray) {
        val type = ActionCodec.peekType(payload) ?: return
        val action = actions[type] ?: return // 未登録のアクション (faxPage など) は、組み立てずに捨てる
        if (!slot.active && !action.receiveWhilePending) return
        val msg = slot.reassembler.feed(payload) ?: return
        try {
            action.onMessage?.invoke(msg, id)
        } catch (e: Exception) {
            Runtime.log("action ${msg.type} handler error: ${e.message}")
        }
    }

    private fun maybeActivate(slot: Slot) {
        if (slot.active || slots[slot.id] !== slot) return
        if (!slot.localPassed || !slot.remoteReady) return
        slot.active = true
        slot.timeout?.cancel()
        localTracks.forEach { attachTrack(slot, it) }
        onPeerJoin?.invoke(slot.id)
    }

    private fun exitPeer(id: String, peer: RtcPeer?) {
        val slot = slots[id] ?: return
        if (peer != null && slot.peer !== peer) return
        slots.remove(id)
        slot.timeout?.cancel()
        val st = states[id]
        if (st != null && st.connected === slot.peer) {
            st.connected = null
            st.unhealthySince = 0
        }
        slot.peer.destroy("exit")
        if (slot.active) onPeerLeave?.invoke(id)
        if (!left) requeueAnnounce() // 相手が消えたら、すぐ探し直す
    }

    /** データチャネルが開いた相手を部屋に渡す (shared-peer の bind + room の onPeer)。 */
    private fun onPeerConnect(peer: RtcPeer, id: String) {
        slots[id]?.let {
            if (it.peer === peer) return
            it.peer.destroy("replaced")
            slots.remove(id)
        }
        val slot = Slot(id, peer)
        slots[id] = slot
        peer.setDataHandler { bytes -> handleFrame(id, slot, bytes) }
        peer.onClose = { exitPeer(id, peer) }
        peer.onRemoteAudio = { track -> onRemoteAudio?.invoke(id, track) }
        peer.onError = { Runtime.log("peer $id error: $it"); exitPeer(id, peer) }
        // 接続後の SDP と候補は、すべてデータチャネルの @_signal で送る (入室扱いになってから)
        peer.setSignalHandler { type, sdp ->
            if (slot.active) signalAction.sendJson(JSONObject().put("type", type).put("sdp", sdp), id)
        }
        // この相手に、この部屋にいることを知らせる (shared-peer の在室フレーム)
        peer.send(ActionCodec.wrapPresenceFrame(roomToken, true))
        // 確認の制限時間は10秒。パスワード無しなので、こちらは即「確認済み」として準備完了を送る
        slot.timeout = Runtime.scope.launch {
            delay(HANDSHAKE_TIMEOUT_MS)
            if (slots[id] === slot && !slot.active) {
                Runtime.log("handshake timed out: $id")
                exitPeer(id, peer)
            }
        }
        slot.localPassed = true
        hsReadyAction.sendString("", id)
        maybeActivate(slot)
    }

    // ================================================================ 相手探し (strategy.ts / signal-handler.ts)

    private fun start() {
        for (i in net.relays.indices) {
            val subId = net.subscribe(this, i, listOf(rootTopic, selfTopic))
            subIds.add(i to subId)
            announceJobs.add(announceLoop(i))
        }
    }

    private fun announceLoop(relay: Int): Job = Runtime.scope.launch {
        var attempt = 0
        while (!left) {
            net.relays[relay].publish(rootTopic, JSONObject().put("peerId", selfId).toString())
            val warm = ANNOUNCE_WARMUP_MS.getOrNull(attempt)
            attempt++
            delay(if (warm != null) minOf(ANNOUNCE_STEADY_MS, warm) else ANNOUNCE_STEADY_MS)
        }
    }

    /** 相手が消えた/つなぎ直すときに、announce を最初からやり直す。 */
    private fun requeueAnnounce() {
        if (left) return
        announceJobs.forEach { it.cancel() }
        announceJobs.clear()
        for (i in net.relays.indices) announceJobs.add(announceLoop(i))
    }

    private var reannounceJob: Job? = null

    /** 続けて呼ばれても1回にまとめて、1秒後に announce をやり直す。 */
    private fun reannounceSoon() {
        if (left || reannounceJob != null) return
        reannounceJob = Runtime.scope.launch {
            delay(1_000)
            reannounceJob = null
            requeueAnnounce()
        }
    }

    private fun newPeer(initiator: Boolean) = RtcPeer(net.factory, net.iceServers(), initiator)

    private fun unfinishedCount() = states.values.count { it.offerPeer != null || it.answering != null }

    private fun peerTopic(peerId: String) = TrysteroCrypto.sha1Topic(TrysteroCrypto.topicPath(rootTopicPlain, peerId))

    /** リレーから届いたメッセージ (announce / offer / answer / candidate) を処理する。 */
    internal fun handleRelayMessage(relay: Int, topic: String, raw: String) {
        if (left) return
        val payload = try {
            JSONObject(raw)
        } catch (e: Exception) {
            return
        }
        for (k in SIGNAL_KEYS) {
            if (payload.has(k)) {
                val v = payload.opt(k)
                if (v !is String || v.isEmpty()) return
            }
        }
        val peerId = payload.optString("peerId", "")
        if (peerId.isEmpty() || peerId == selfId) return
        if (topic != rootTopic && topic != selfTopic) return
        val offer = payload.optString("offer", "").ifEmpty { null }
        val answer = payload.optString("answer", "").ifEmpty { null }
        val candidate = payload.optString("candidate", "").ifEmpty { null }
        val offerId = payload.optString("offerId", "").ifEmpty { null }

        val st = state(peerId)
        val connected = st.connected
        if (connected != null) {
            when (connected.health()) {
                RtcPeer.Health.LIVE -> {
                    st.unhealthySince = 0
                    return
                }
                RtcPeer.Health.STALE -> clearConnected(st)
                RtcPeer.Health.TRANSIENT -> {
                    val now = System.currentTimeMillis()
                    if (st.unhealthySince == 0L) st.unhealthySince = now
                    if (now - st.unhealthySince < DISCONNECTED_GRACE_MS) return
                    clearConnected(st)
                }
            }
        }

        val isAnnouncement = offer == null && answer == null && candidate == null
        when {
            isAnnouncement -> handleAnnouncement(relay, peerId, st)
            offer != null -> handleOffer(relay, peerId, st, offer, offerId)
            candidate != null -> handleCandidate(peerId, st, candidate, offerId)
            answer != null -> handleAnswer(peerId, st, answer, offerId)
        }
    }

    private fun clearConnected(st: PState) {
        val p = st.connected ?: return
        st.connected = null
        st.unhealthySince = 0
        if (!p.isDead) p.destroy("stale")
    }

    private fun handleAnnouncement(relay: Int, peerId: String, st: PState) {
        if (st.answering != null || st.connected != null || st.offerAnswered) return
        val lead = selfId < peerId
        Runtime.log("announce from ${peerId.take(5)} via relay $relay (lead=$lead)")
        if (!lead && st.offerPeer == null && st.offerInit == null) {
            // オファーを作るのは相手の役目。こちらの存在を相手の selfTopic へ知らせて待つ
            net.relays[relay].publish(peerTopic(peerId), JSONObject().put("peerId", selfId).toString())
            return
        }
        if (st.offerRelays.containsKey(relay)) return
        if (unfinishedCount() >= MAX_UNFINISHED_PEERS) {
            Runtime.log("too many unfinished peers; announcement from $peerId ignored")
            return
        }
        st.offerRelays[relay] = null
        Runtime.scope.launch { sendOffer(relay, peerId, st) }
    }

    private suspend fun ensureOffer(st: PState, peerId: String): OfferInfo? {
        st.offerInfo?.let { return it }
        st.offerInit?.let { return it.await() }
        val result = CompletableDeferred<OfferInfo?>()
        st.offerInit = result
        try {
            val peer = newPeer(true)
            val sdp = withTimeoutOrNull(OFFER_BUILD_TIMEOUT_MS) { peer.offer.await() }
            if (sdp == null || peer.isDead || left || st.answering != null || st.connected != null) {
                peer.destroy("offer not usable")
                result.complete(null)
                return null
            }
            val info = OfferInfo(peer, TrysteroCrypto.genId(OFFER_ID_SIZE), TrysteroCrypto.encrypt(key, sdp))
            st.offerPeer = peer
            st.offerInfo = info
            st.offerAnswered = false
            st.offerBacklog.clear()
            peer.onConnect = { connectPeer(peer, peerId) }
            val closed = {
                if (st.offerPeer === peer && st.connected == null) resetOfferState(st)
            }
            peer.onClose = { closed() }
            peer.onError = { closed() }
            peer.setSignalHandler { type, s ->
                if (st.offerPeer === peer && type == "candidate") {
                    st.offerBacklog.add(s)
                    st.signalRelays.forEach { r -> publishCandidate(r, peerId, st, info, s) }
                }
            }
            scheduleOfferExpiry(st, peerId, info.id, OFFER_TTL_MS)
            result.complete(info)
            return info
        } catch (e: Exception) {
            result.complete(null)
            return null
        } finally {
            st.offerInit = null
        }
    }

    private fun publishCandidate(relay: Int, peerId: String, st: PState, info: OfferInfo, plainCandidate: String) {
        if (left || st.connected != null || st.offerPeer !== info.peer || st.offerInfo !== info) return
        val msg = JSONObject().put("peerId", selfId).put("offerId", info.id)
            .put("candidate", TrysteroCrypto.encrypt(key, plainCandidate))
        net.relays[relay].publish(peerTopic(peerId), msg.toString())
    }

    private suspend fun sendOffer(relay: Int, peerId: String, st: PState) {
        val info = ensureOffer(st, peerId)
        val usable = info != null && !left && st.connected == null && st.answering == null && !st.offerAnswered &&
            st.offerRelays.containsKey(relay) && st.offerInfo === info
        if (!usable || info == null) {
            st.offerRelays.remove(relay)
            return
        }
        // 一定時間たったら、このリレーでの送信済みを忘れて、次の announce でオファーを送り直せるようにする
        st.offerRelays[relay]?.cancel()
        st.offerRelays[relay] = Runtime.scope.launch {
            delay(OFFER_RELAY_PRUNE_MS)
            if (st.connected == null) st.offerRelays.remove(relay)
        }
        val msg = JSONObject().put("peerId", selfId).put("offerId", info.id).put("offer", info.cipher)
        val sent = net.relays[relay].publish(peerTopic(peerId), msg.toString())
        Runtime.log("offer ${info.id.take(4)} sent to ${peerId.take(5)} via relay $relay (sent=$sent)")
        st.signalRelays.add(relay)
        st.offerBacklog.toList().forEach { publishCandidate(relay, peerId, st, info, it) }
    }

    private fun resetOfferState(st: PState) {
        st.offerExpiry?.cancel()
        st.offerExpiry = null
        st.offerRelays.values.forEach { it?.cancel() }
        st.offerRelays.clear()
        st.signalRelays.clear()
        st.offerBacklog.clear()
        val p = st.offerPeer
        st.offerPeer = null
        st.offerInfo = null
        st.offerAnswered = false
        if (p != null && p !== st.connected && !p.isDead) p.destroy("offer reset")
    }

    private fun scheduleOfferExpiry(st: PState, peerId: String, offerId: String, ttlMs: Long) {
        st.offerExpiry?.cancel()
        st.offerExpiry = Runtime.scope.launch {
            delay(ttlMs)
            if (st.connected == null && st.offerInfo?.id == offerId) {
                if (st.offerAnswered) Runtime.log("could not connect to $peerId after exchanging SDP")
                resetOfferState(st)
            }
        }
    }

    private fun handleOffer(relay: Int, peerId: String, st: PState, offerCipher: String, offerId: String?) {
        if (st.answering != null || st.offerAnswered) return
        Runtime.log("offer ${offerId?.take(4)} from ${peerId.take(5)} via relay $relay")
        val hasTrackedOffer = st.offerPeer != null || st.offerRelays.isNotEmpty() || st.offerInit != null
        // 同時にオファーを出し合ったら、selfId が小さい側が自分のオファーを優先する
        if (hasTrackedOffer && selfId < peerId) return
        if (unfinishedCount() >= MAX_UNFINISHED_PEERS && !hasTrackedOffer) {
            Runtime.log("too many unfinished peers; offer from $peerId ignored")
            return
        }
        if (hasTrackedOffer) resetOfferState(st)
        val plainOffer = try {
            TrysteroCrypto.decrypt(key, offerCipher)
        } catch (e: Exception) {
            Runtime.log("offer decrypt failed (room id / app id mismatch?): ${e.message}")
            return
        }
        // 中身の無いオファー (m= 行が1つも無い) は、答えてもつながらない。無視して、少ししたら announce をやり直す
        if (!plainOffer.contains("\nm=")) {
            Runtime.log("offer from ${peerId.take(5)} has no media sections; ignored")
            reannounceSoon()
            return
        }
        val peer = newPeer(false)
        st.answering = peer
        st.answerSent = false
        st.answeringExpiry?.cancel()
        st.answeringExpiry = Runtime.scope.launch {
            delay(ANSWERING_TTL_MS)
            if (st.connected == null && st.answering === peer) {
                if (st.answerSent) Runtime.log("could not connect to $peerId after exchanging SDP")
                st.answering = null
                peer.destroy("answer expired")
            }
        }
        peer.onConnect = { connectPeer(peer, peerId) }
        val closed = {
            if (st.answering === peer) {
                st.answeringExpiry?.cancel()
                st.answering = null
                st.answerSent = false
            }
        }
        peer.onClose = { closed() }
        peer.onError = { closed() }
        val replyTopic = peerTopic(peerId)
        peer.setSignalHandler { type, sdp ->
            if (!left && st.answering === peer && !peer.isDead && (type == "answer" || type == "candidate")) {
                val msg = JSONObject().put("peerId", selfId)
                val cipher = TrysteroCrypto.encrypt(key, sdp)
                if (type == "answer") {
                    st.answerSent = true
                    msg.put("answer", cipher)
                } else {
                    msg.put("candidate", cipher)
                }
                if (offerId != null) msg.put("offerId", offerId)
                val sent = net.relays[relay].publish(replyTopic, msg.toString())
                if (type == "answer") Runtime.log("answer sent to ${peerId.take(5)} via relay $relay (sent=$sent)")
            }
        }
        peer.signal("offer", plainOffer)
        // オファーより先に届いていた候補
        for (k in listOfNotNull(offerId, LEGACY_KEY)) {
            st.pendingCandidates.remove(k)?.forEach { peer.signal("candidate", it) }
        }
    }

    private fun handleCandidate(peerId: String, st: PState, candidateCipher: String, offerId: String?) {
        val plain = try {
            TrysteroCrypto.decrypt(key, candidateCipher)
        } catch (e: Exception) {
            return
        }
        val offerMatch = if (offerId != null && st.offerInfo?.id == offerId) st.offerPeer else null
        val fallbackOffer = if (offerId == null) st.offerPeer else null
        val target = offerMatch ?: st.answering ?: fallbackOffer
        if (target == null || target.isDead) {
            val list = st.pendingCandidates.getOrPut(offerId ?: LEGACY_KEY) { ArrayList() }
            if (list.size < MAX_BUFFERED_CANDIDATES) list.add(plain)
            return
        }
        target.signal("candidate", plain)
    }

    private fun handleAnswer(peerId: String, st: PState, answerCipher: String, offerId: String?) {
        val plain = try {
            TrysteroCrypto.decrypt(key, answerCipher)
        } catch (e: Exception) {
            Runtime.log("answer decrypt failed: ${e.message}")
            return
        }
        val peer = st.offerPeer
        val info = st.offerInfo
        if (peer == null || info == null || st.offerAnswered || (offerId != null && offerId != info.id) || peer.isDead) return
        Runtime.log("answer from ${peerId.take(5)} for offer ${info.id.take(4)}")
        st.offerAnswered = true
        scheduleOfferExpiry(st, peerId, info.id, OFFER_POST_ANSWER_TTL_MS)
        peer.signal("answer", plain)
    }

    /** データチャネルが開いた (相手とつながった)。 */
    private fun connectPeer(peer: RtcPeer, peerId: String) {
        if (left) {
            peer.destroy("room left")
            return
        }
        val st = state(peerId)
        val existing = st.connected
        if (existing != null) {
            if (existing !== peer && !peer.isDead) peer.destroy("duplicate")
            return
        }
        st.connected = peer
        st.unhealthySince = 0
        Runtime.log("connected to ${peerId.take(5)} (${if (peer.initiator) "offerer" else "answerer"})")
        // つながらなかったほうの未完成の接続を片付ける
        st.answeringExpiry?.cancel()
        val ans = st.answering
        st.answering = null
        st.answerSent = false
        if (ans != null && ans !== peer && !ans.isDead) ans.destroy("superseded")
        resetOfferState(st)
        onPeerConnect(peer, peerId)
    }

    companion object {
        private val SIGNAL_KEYS = listOf("offer", "answer", "candidate")
        private val ANNOUNCE_WARMUP_MS = listOf(233L, 533L, 1333L)
        private const val ANNOUNCE_STEADY_MS = 60_000L
        private const val OFFER_TTL_MS = 57_333L
        private const val OFFER_POST_ANSWER_TTL_MS = 23_333L
        private const val ANSWERING_TTL_MS = 23_333L
        private const val OFFER_RELAY_PRUNE_MS = 4_800L // announce 間隔 5.333 秒の 0.9 倍
        private const val OFFER_ID_SIZE = 12
        private const val DISCONNECTED_GRACE_MS = 7_533L
        private const val HANDSHAKE_TIMEOUT_MS = 10_000L
        private const val OFFER_BUILD_TIMEOUT_MS = 15_000L
        private const val MAX_UNFINISHED_PEERS = 12
        private const val MAX_BUFFERED_CANDIDATES = 64
        private const val LEGACY_KEY = "__legacy__"
    }
}
