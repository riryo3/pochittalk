package app.pochitalk.engine

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Network
import androidx.core.content.ContextCompat
import app.pochitalk.audio.MicGain
import app.pochitalk.audio.MicMonitor
import app.pochitalk.audio.RadioSounds
import app.pochitalk.rtc.PresenceClient
import app.pochitalk.rtc.RelayList
import app.pochitalk.rtc.Runtime
import app.pochitalk.rtc.TurnClient
import app.pochitalk.rtc.TrysteroNetwork
import app.pochitalk.rtc.TrysteroRoom
import app.pochitalk.service.CallService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.ExternalAudioProcessingFactory
import org.webrtc.AudioTrack
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.audio.JavaAudioDeviceModule
import java.security.SecureRandom
import kotlin.math.min
import kotlin.math.sqrt

/**
 * アプリ全体の状態とふるまい。Web版 (worker.js) のクライアントコードに対応する:
 * ロビー(部屋一覧)、部屋への入退室、ボタンを押して話す、話中ロック、混線、VOX、効果音。
 *
 * 内部状態はすべて Runtime.scope (単一スレッド) 上で触る。UI からの呼び出しは各 public 関数が
 * scope.launch でエンジンスレッドに移す。UI へは [state] (StateFlow) で伝える。
 */
object PochiEngine {
    // ---- Web版と共通のプロトコル定数。変えるとWeb版と通話できなくなる
    // 0.25.4 の通信形式は 0.20.0 と互換が無いので、識別名も新しくして、古い版とは別の世界にしている (Web版と同じ)
    const val APP_ID = "pochitalk-v2"
    const val BOT_ROOM_KEY = "7a0b07c1" // おうむ返しボットの部屋 (タグは固定)
    const val MAX_ROOM = 8 // 1つの部屋は8人まで (Web版と同じ)
    private const val ACTION_PTT_STATE = "pttState"
    private const val ACTION_PTT_NAME = "pttName"
    private const val ACTION_ROOM_TAG = "roomTag" // Web版と共通: {tag, by, at}。話題タグ。新しい(at が大きい)ほうが勝つ
    private const val TAG_MAX = 30
    private const val ACTION_FAX_PAGE = "faxPage" // Web版と共通: {c: 幅, d: base64}。FAX の中身 (14行ぶん・1画素1ビット)
    private const val ACTION_JOIN_AGE = "joinAge" // Web版と共通: 入室してからの経過時間を交換し、新しく来た側を判定する

    /** 招待URL。Web版の公開URLに合わせて変更する。 */
    const val INVITE_BASE_URL = "https://pochittalk.ryota-softwares.workers.dev/"

    private const val PREFS = "pochitalk"
    private const val PREF_NAME = "pochitalk_ptt_name"
    // Web版とは入力レベルが違うので、Android専用のキー (Web版の "pochitalk_vox_thr" とは別の値の意味)
    private const val PREF_VOX_THR = "pochitalk_vox_level"
    private const val PREF_MIC_GAIN = "pochitalk_input_db"      // Web版と同じキー名 (0〜30dB)
    private const val PREF_SFX_VOL = "pochitalk_sfx_vol"       // Web版と同じキー名 (0〜150%)
    private const val PREF_PTT_POS = "pochitalk_ptt_pos"       // 話すボタンの位置。"left" / "right" のときだけ保存 (中央は標準)
    private const val PREF_LEFTY = "pochitalk_lefty"           // Web版と同じ: オンにしたときだけ "1" を保存
    private const val PREF_AUTO_RECONNECT = "pochitalk_auto_reconnect" // 自動で再接続する: オンにしたときだけ "1" を保存 (標準はオフ)
    private const val PREF_WELCOME = "pochitalk_welcome"       // Web版と同じ: オフにしたときだけ "off" を保存
    private const val DEFAULT_VOX_STEP = 4
    private const val STREAM_ID = "pochitalk-audio"
    private const val VOX_HOLD_MS = 1500L
    /** 送信を続けるかの判定は、開始のしきい値より低くして (ヒステリシス)、語尾や言葉の間で切れないようにする。 */
    private const val VOX_HOLD_RATIO = 0.6f
    private const val VOX_COOLDOWN_MS = 700L
    private const val LOBBY_STALE_MS = 20_000L   // 在室通知がこれだけ途絶えたら、一覧から消す (Web版 PRESENCE_EXPIRE_MS)
    private const val PRESENCE_BEAT_MS = 6_000L  // 在室通知を流す間隔 (Web版 PRESENCE_BEAT_MS)
    private const val MISMATCH_NOTIFY_MS = 10_000L
    private const val MISMATCH_RECONNECT_MS = 25_000L
    private const val AUTO_RECONNECT_GAP_MS = 90_000L
    private const val METER_INTERVAL_MS = 50L
    private const val RX_POLL_INTERVAL_MS = 150L

    private lateinit var app: Application
    private lateinit var prefs: SharedPreferences
    private var initialized = false

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()
    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<UiEvent> = _events.asSharedFlow()

    private val _meter = MutableStateFlow(MeterState())
    val meter: StateFlow<MeterState> = _meter.asStateFlow()

    val sounds = RadioSounds()
    private val micGain = MicGain()
    private var audioModule: JavaAudioDeviceModule? = null

    /** 待機中のマイク音量の監視 (VOX・レベルメーター用)。送信中は止めて libwebrtc の録音の音量を使う。 */
    private val micMonitor = MicMonitor { rms -> pushMonRms(rms) }

    // ---------------------------------------------------------------- エンジンスレッド専用の状態

    private var factory: PeerConnectionFactory? = null
    private var net: TrysteroNetwork? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null

    private val http by lazy { TrysteroNetwork.newHttpClient() }
    private val turn by lazy { TurnClient(http, INVITE_BASE_URL + "api/turn") }
    private var presence: PresenceClient? = null
    private var presAnnounced = false
    private var presLastSent = 0L
    private var presPending: Job? = null
    private var mismatchSince = 0L
    private var mismatchNoted = false
    private var lastAutoReconnect = 0L
    private class LobbyEntry(
        val key: String,
        val talking: Boolean,
        val name: String,
        val ts: Long,
        val tag: String = "",
        val tagBy: String = "",
        val tagAt: Long = 0L,
    )
    private val lobbyEntries = HashMap<String, LobbyEntry>()

    private var room: TrysteroRoom? = null
    private var pttStateAction: TrysteroRoom.Action? = null
    private var pttNameAction: TrysteroRoom.Action? = null
    private class PeerState(var name: String, var talking: Boolean, var joinJudged: Boolean = false, var enteredAt: Long = 0L)
    private val peers = LinkedHashMap<String, PeerState>()

    /** モールスと FAX の受信 (相手の声から読む / faxPage のデータを紙に出す) */
    private val rx = RxExtras(
        Runtime.scope,
        nameOf = { id -> peers[id]?.name ?: "" },
        onMorse = { from, text -> _state.update { it.copy(morseText = text, morseFrom = from) } },
        onFax = { paper -> _state.update { it.copy(fax = paper) } },
    )

    private var myNickname = ""
    private var currentKey: String? = null
    private var pendingKey: String? = null
    private class Meta(val tag: String, val by: String, val at: Long)
    private var roomMeta = Meta("", "", 0L)
    private var roomTagAction: TrysteroRoom.Action? = null
    private var reconnecting = false
    @Volatile private var hiddenAt = 0L
    private var micTest = false
    private var roomEnterTime = 0L
    private var currentTalkerId: String? = null
    private var isTransmitting = false
    private var pressed = false

    private var flashJob: Job? = null
    private var crosstalkJob: Job? = null

    // VOX
    private var voxJob: Job? = null
    private var voxHits = 0
    private var voxLastVoice = 0L
    private var voxCooldownUntil = 0L
    private var voxInitiated = false

    @Volatile private var monLevel = 0f   // 待機用の録音 (MicMonitor) の音量
    @Volatile private var lastMonAt = 0L
    @Volatile private var rtcLevel = 0f   // libwebrtc の録音の音量 (送信中だけ来る)
    @Volatile private var lastRtcAt = 0L

    /** 新しい方の録音から、直近300ms以内の大きい方の音量を返す。取れていなければ null。 */
    private fun currentMicLevel(now: Long): Float? {
        val mon = if (now - lastMonAt <= 300) monLevel else null
        val rtc = if (now - lastRtcAt <= 300) rtcLevel else null
        return when {
            mon != null && rtc != null -> maxOf(mon, rtc)
            else -> mon ?: rtc
        }
    }

    // レベルメーター (Web版の draw() と同じ: 平滑化 + ピークホールド)
    private var meterLevel = 0f
    private var meterPeak = 0f
    private var meterPeakHoldUntil = 0L
    private var rxLevel = 0.0
    private var rxPolledAt = 0L
    private var rxPolling = false

    // ================================================================ 起動

    fun init(application: Application) {
        if (initialized) return
        initialized = true
        app = application
        prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        myNickname = prefs.getString(PREF_NAME, null)
            ?: ("無線機_" + (100 + SecureRandom().nextInt(899)))
        val savedThr = prefs.getInt(PREF_VOX_THR, DEFAULT_VOX_STEP).coerceIn(1, 10)
        _state.update { it.copy(nickname = myNickname, voxSens = savedThr) }
        _state.update { it.copy(voxThreshold = voxMeterFraction(voxThreshold())) }
        val savedGain = prefs.getInt(PREF_MIC_GAIN, 0).coerceIn(0, 30)
        micGain.gain = Math.pow(10.0, savedGain / 20.0).toFloat()
        _state.update { it.copy(micGainDb = savedGain, welcomeOn = prefs.getString(PREF_WELCOME, null) != "off", autoReconnect = prefs.getString(PREF_AUTO_RECONNECT, null) == "1") }
        val savedSfx = prefs.getInt(PREF_SFX_VOL, 100).coerceIn(0, 150)
        sounds.volume = savedSfx / 100f
        val savedPos = when (prefs.getString(PREF_PTT_POS, null)) {
            "left" -> PttPosition.LEFT
            "right" -> PttPosition.RIGHT
            else -> PttPosition.CENTER
        }
        _state.update { it.copy(sfxVolume = savedSfx, lefty = prefs.getString(PREF_LEFTY, null) == "1", pttPos = savedPos) }
        refreshMicPermission()
        registerNetworkWatcher()
        Runtime.scope.launch { startNetwork() }
    }

    private suspend fun startNetwork() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions(),
        )
        val module = JavaAudioDeviceModule.builder(app)
            .setSamplesReadyCallback { samples -> onMicSamples(samples) }
            .setAudioRecordStateCallback(object : JavaAudioDeviceModule.AudioRecordStateCallback {
                override fun onWebRtcAudioRecordStart() { Runtime.scope.launch { onRtcRecording(true) } }
                override fun onWebRtcAudioRecordStop() { Runtime.scope.launch { onRtcRecording(false) } }
            })
            .createAudioDeviceModule()
        audioModule = module
        val processing = ExternalAudioProcessingFactory()
        processing.setCapturePostProcessing(micGain)
        val f = PeerConnectionFactory.builder()
            .setAudioDeviceModule(module)
            .setAudioProcessingFactory(processing)
            .createPeerConnectionFactory()
        factory = f
        // TURN の資格情報は /api/turn から短命のものを受け取る (鍵は端末に持たない)。取れなければ STUN だけ
        turn.refresh(force = true)
        val (roomRelays, presenceRelays) = RelayList.pick(http)
        Runtime.log("relays: room=$roomRelays presence=$presenceRelays turn=${turn.hasTurn}")
        val n = TrysteroNetwork(f, { turn.iceServers }, roomRelays, http)
        net = n
        presenceUrls = presenceRelays
        n.start()
        startPresence()
        _state.update { it.copy(ready = true) }
        renderScan()
        takeWantJoin()
        Runtime.scope.launch {
            while (isActive) {
                meterTick()
                delay(METER_INTERVAL_MS)
            }
        }
        Runtime.scope.launch {
            while (isActive) {
                delay(PRESENCE_BEAT_MS)
                val now = System.currentTimeMillis()
                lobbyEntries.values.removeAll { now - it.ts > LOBBY_STALE_MS }
                announce()
                renderScan()
            }
        }
        Runtime.scope.launch {
            while (isActive) {
                delay(3_000)
                checkMismatch()
                updateCounts()
            }
        }
        Runtime.scope.launch {
            while (isActive) {
                delay(5_000)
                checkRoomFull()
            }
        }
        Runtime.scope.launch {
            while (isActive) {
                delay(5 * 60_000L)
                turn.refresh() // 10分以内に取れていれば何もしない
            }
        }
    }

    // ================================================================ 権限

    private fun micGranted() =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** Activity が権限ダイアログの後や onResume で呼ぶ。 */
    fun refreshMicPermission() {
        val granted = micGranted()
        _state.update { it.copy(micGranted = granted) }
        if (granted) Runtime.scope.launch {
            if (room != null) {
                ensureMic()
                updateMicMonitor()
                if (!CallService.isRunning) startForegroundService()
            }
        }
    }

    // ================================================================ ロビー (部屋一覧)

    private var presenceUrls: List<String> = RelayList.NOSTR_RELAY_URLS

    /** 在室通知 (Nostr リレー) を始める。通話の接続とは別のしくみ (Web版の joinLobby)。 */
    private fun startPresence() {
        presence?.close()
        val pc = PresenceClient(http, presenceUrls) { pubkey, d -> Runtime.scope.launch { onPresence(pubkey, d) } }
        presence = pc
        pc.start()
    }

    private fun onPresence(pubkey: String, d: JSONObject) {
        val ch = d.optString("ch", "")
        if (ch.isEmpty()) {
            if (lobbyEntries.remove(pubkey) != null) renderScan()
            return
        }
        if (!isRoomKey(ch)) return
        val isNew = !lobbyEntries.containsKey(pubkey)
        lobbyEntries[pubkey] = LobbyEntry(
            key = ch,
            talking = d.optBoolean("talking", false),
            name = d.optString("name", "?").take(12),
            ts = System.currentTimeMillis(),
            tag = capTag(d.optString("tag", "")),
            tagBy = d.optString("by", "").take(12),
            tagAt = d.optLong("at", 0L),
        )
        if (isNew) {
            // 新しく来た人に、こちらの在室をすぐ知らせる (Web版の announceSoon)
            Runtime.scope.launch {
                delay(300L + (Math.random() * 1200).toLong())
                announce()
            }
        }
        renderScan()
    }

    /**
     * 部屋一覧 (在室通知) の取り直し (Web版の presenceRefresh): 画面に戻ったとき、回線が戻ったときに呼ぶ。
     * 待ち時間をリセットし、開いているリレーには購読をやり直し、死んだ接続はつなぎ直して、
     * 自分の在室をすぐ知らせ、一覧を描き直す。入室中でもホームでも効く。
     */
    fun refreshPresence() {
        Runtime.scope.launch {
            val p = presence ?: return@launch
            Runtime.log("presence refresh")
            p.refresh()
            presLastSent = 0L // すぐ知らせられるように、間引きを解除
            announce()
            renderScan()
        }
    }

        /**
     * いまどの部屋にいるかを知らせる (Web版の announce)。続けて呼ばれても1秒に1回にまとめる。
     * 部屋にいないときは何も送らない (出たときだけ、1回「いない」と送る)。
     */
    private fun announce() {
        val p = presence ?: return
        val gap = System.currentTimeMillis() - presLastSent
        if (gap < 1000) {
            if (presPending == null) {
                presPending = Runtime.scope.launch {
                    delay(1000 - gap)
                    presPending = null
                    announce()
                }
            }
            return
        }
        val key = currentKey
        if (key == null) {
            if (!presAnnounced) return
            presAnnounced = false
            presLastSent = System.currentTimeMillis()
            p.publish(JSONObject().put("ch", ""))
            return
        }
        presAnnounced = true
        presLastSent = System.currentTimeMillis()
        p.publish(
            JSONObject().put("ch", key).put("talking", isTransmitting).put("name", myNickname)
                .put("tag", roomMeta.tag).put("by", roomMeta.by).put("at", roomMeta.at),
        )
    }

    private class Stat(
        var count: Int = 0,
        var air: Boolean = false,
        val names: MutableList<String> = ArrayList(),
        var tag: String = "",
        var tagBy: String = "",
        var tagAt: Long = 0L,
    )

    private fun renderScan() {
        updateCounts()
        val stats = HashMap<String, Stat>()
        for (e in lobbyEntries.values) {
            val s = stats.getOrPut(e.key) { Stat() }
            s.count++
            s.names.add(e.name)
            if (e.talking) s.air = true
            if (e.tagAt > s.tagAt) { // 部屋のタグは、いちばん新しいものを採用する
                s.tagAt = e.tagAt
                s.tag = e.tag
                s.tagBy = e.tagBy
            }
        }
        val cur = currentKey
        if (cur != null) {
            val s = stats.getOrPut(cur) { Stat() }
            s.count++
            s.names.add(0, myNickname + "(自分)")
            if (isTransmitting) s.air = true
            if (roomMeta.at > s.tagAt) {
                s.tagAt = roomMeta.at
                s.tag = roomMeta.tag
                s.tagBy = roomMeta.by
            }
        }
        val pend = pendingKey
        if (pend != null && !stats.containsKey(pend)) stats[pend] = Stat()
        var total = 0
        stats.values.forEach { total += it.count }
        val rooms = stats.keys.sorted().map { k ->
            val s = stats.getValue(k)
            RoomInfo(
                key = k,
                count = s.count,
                air = s.air,
                names = s.names.toList(),
                invited = k == pend && s.count == 0,
                isCurrent = k == cur,
                tag = s.tag,
                tagBy = s.tagBy,
            )
        }
        _state.update { it.copy(rooms = rooms, totalPeople = total, pendingKey = pend) }
    }

    // ================================================================ 入退室

    fun createRoom() {
        val bytes = ByteArray(4).also { SecureRandom().nextBytes(it) }
        val key = bytes.joinToString("") { String.format("%02x", it.toInt() and 0xff) }
        join(key)
        Runtime.scope.launch { flash("新しい部屋を作りました。招待で友達を呼べます") }
    }

    fun join(key: String) {
        Runtime.scope.launch { joinInternal(key) }
    }

    /** 起動直後や再接続の最中に押された入室。準備ができたら、そのまま入る (捨てない)。 */
    private var wantJoin: String? = null

    private fun joinInternal(key: String) {
        if (!isRoomKey(key)) return
        val n = net
        if (n == null || reconnecting) {
            // 準備中の net は、まだ無い / 閉じかけで、ここで入っても通話の接続ができない。準備ができるまで覚えておく
            wantJoin = key
            return flash("接続の準備中です。終わりしだい入室します")
        }
        if (isTransmitting) return flash("送信中は部屋を変えられません")
        if (key == currentKey) return flash("すでにこの部屋です")
        // 満員の部屋には入れない (一覧の人数が上限のとき)
        if (lobbyEntries.values.count { it.key == key } >= MAX_ROOM) return flash("この部屋は満員です（${MAX_ROOM}人まで）")
        leaveInternal(keepService = true)
        persistNickname()
        currentKey = key
        pendingKey = null
        micTest = false
        _state.update { it.copy(micTest = false) }
        stopVoxInternal() // Web版と同じく、入室するとVOXはオフに戻る
        roomEnterTime = System.currentTimeMillis()
        roomMeta = Meta("", "", 0L)
        _state.update { it.copy(roomTag = "", roomTagBy = "") }

        connectRoom(n, key)

        enterAudioSession()
        ensureMic()
        startForegroundService()
        updateMicMonitor()
        resetStatus()
        _state.update { it.copy(currentKey = key, pendingKey = null) }
        renderPeers()
        announce()
        renderScan()
    }

    /** 通話部屋に接続して、アクションを配線する。入室と再接続で共用する (入室時刻とタグは呼び出し側が管理)。 */
    private fun connectRoom(n: TrysteroNetwork, key: String) {
        val r = n.joinRoom(APP_ID, "h-$key")
        room = r
        val stateAction = r.action(ACTION_PTT_STATE)
        val nameAction = r.action(ACTION_PTT_NAME)
        val joinAgeAction = r.action(ACTION_JOIN_AGE)
        val tagAction = r.action(ACTION_ROOM_TAG)
        val faxAction = r.action(ACTION_FAX_PAGE)
        rx.clear() // 前の部屋の聞き取りをやめる
        r.onRemoteAudio = { id, track -> rx.attach(id, track) }
        faxAction.onMessage = { msg, peerId ->
            if (msg.isJson) {
                val j = msg.json()
                rx.onFaxPage(peerId, j.optInt("c", 0), j.optString("d", ""))
            }
        }
        pttStateAction = stateAction
        pttNameAction = nameAction
        roomTagAction = tagAction

        nameAction.onMessage = { msg, peerId ->
            peers[peerId]?.let {
                it.name = msg.text.take(24)
                renderPeers()
                renderScan()
            }
        }
        stateAction.onMessage = { msg, peerId ->
            if (msg.isJson) onPttState(peerId, msg.json().optBoolean("isTalking", false))
        }
        // 新しく来た人を判定して、すでに部屋にいる側だけ入室音を鳴らす (Web版と同じ仕組み)
        joinAgeAction.onMessage = { msg, peerId ->
            val peer = peers[peerId]
            if (peer != null && msg.isJson) {
                val a0 = msg.json().optLong("age", -1)
                if (a0 >= 0) {
                    peer.enteredAt = System.currentTimeMillis() - a0
                    Runtime.scope.launch {
                        delay(500)
                        checkRoomFull()
                    }
                }
            }
            if (peer != null && !peer.joinJudged && msg.isJson) {
                val age = msg.json().optLong("age", -1)
                if (age >= 0) {
                    peer.joinJudged = true
                    val myAge = System.currentTimeMillis() - roomEnterTime
                    val newer = age < myAge - 1000
                    Runtime.log("joinAge from $peerId: age=${age}ms myAge=${myAge}ms -> " + if (newer) "peer is new (enter tone)" else "no tone")
                    if (newer) sounds.playEnter() // 相手のほうが新しい = 相手が今入ってきた
                }
            }
        }
        // 話題タグ: 新しい(at が大きい)ほうを採用する
        tagAction.onMessage = { msg, _ ->
            if (msg.isJson) {
                val d = msg.json()
                val at = d.optLong("at", 0L)
                if (at > roomMeta.at && currentKey != BOT_ROOM_KEY) { // ボットの部屋のタグは、ほかの人が送ってきても受け付けない
                    roomMeta = Meta(capTag(d.optString("tag", "")), d.optString("by", "").take(12), at)
                    publishMeta()
                }
            }
        }
        r.onPeerJoin = { peerId ->
            peers[peerId] = PeerState("接続中...", false)
            renderPeers()
            Runtime.scope.launch {
                delay(3_000)
                checkRoomFull()
            }
            nameAction.sendString(myNickname, peerId)
            if (roomMeta.at > 0) tagAction.sendJson(metaJson(), peerId) // 後から来た人にも、いまのタグを伝える
            val ageAtJoin = System.currentTimeMillis() - roomEnterTime
            joinAgeAction.sendJson(JSONObject().put("age", ageAtJoin), peerId)
            // 相手が経過時間を送ってこない場合 (別の実装など): 自分が20秒以上いるなら、相手は新規とみなす
            Runtime.scope.launch {
                delay(2_500)
                val p = peers[peerId]
                if (p != null && !p.joinJudged) {
                    p.joinJudged = true
                    if (ageAtJoin > 20_000) sounds.playEnter()
                }
            }
        }
        r.onPeerLeave = { peerId ->
            peers.remove(peerId)
            rx.detach(peerId)
            if (currentTalkerId == peerId) onStopReceiving()
            renderPeers()
        }
        // 入室でも再接続でも、新しい部屋にマイクの音声トラックを付ける (これが無いと、話しても相手に音声が届かない)
        ensureMic()
    }

    fun leave() {
        Runtime.scope.launch { leaveInternal(keepService = false) }
    }

    /** 受信した FAX の紙を片づける (タップ)。 */
    fun dismissFax() {
        _state.update { it.copy(fax = null) }
    }

    private fun leaveInternal(keepService: Boolean) {
        if (room == null && currentKey == null) return
        if (isTransmitting) {
            pressed = false
            stopTransmission()
        }
        room?.leave()
        room = null
        rx.clear()
        pttStateAction = null
        pttNameAction = null
        roomTagAction = null
        roomMeta = Meta("", "", 0L)
        peers.clear()
        currentTalkerId = null
        currentKey = null
        stopVoxInternal()
        updateMicMonitor()
        crosstalkJob?.cancel()
        if (!keepService) {
            exitAudioSession()
            CallService.stop(app)
        }
        resetStatus()
        _state.update { it.copy(currentKey = null, peers = emptyList(), roomTag = "", roomTagBy = "") }
        announce() // 出たことを1回だけ知らせる
        renderScan()
    }

    // ================================================================ 満員・つながり不一致の監視 (Web版の checkRoomFull / checkMismatch)

    /**
     * 同時に入って上限を超えたとき、入室が新しい人から、上限を超えた分が自分で退出する (古い人は追い出されない)。
     * 入室時刻が分からない相手 (古い版など) は、古株として扱う。
     */
    private fun checkRoomFull() {
        if (currentKey == null || room == null) return
        if (peers.size + 1 <= MAX_ROOM) return
        val members = ArrayList<Pair<String, Long>>()
        members.add("me" to roomEnterTime)
        peers.forEach { (id, p) -> members.add(id to p.enteredAt) }
        members.sortWith { a, b -> if (a.second != b.second) a.second.compareTo(b.second) else a.first.compareTo(b.first) }
        val myRank = members.indexOfFirst { it.first == "me" }
        if (myRank < MAX_ROOM) return
        leaveInternal(keepService = false)
        flash("この部屋は満員のため、退出しました（${MAX_ROOM}人まで）")
    }

    /**
     * 在室通知 (リレー経由) と、通話の接続 (WebRTC) は別のしくみなので、通知だけ先に見えて、接続がまだ、または失敗していることがある。
     * 10秒以上ずれたら画面に知らせ、25秒以上ずれたら自動でつなぎ直す (つなぎ直しは90秒に1回まで)。
     */
    private fun checkMismatch() {
        val cur = currentKey
        if (cur == null || room == null) {
            mismatchSince = 0L
            mismatchNoted = false
            return
        }
        val expected = lobbyEntries.values.count { it.key == cur }
        val connected = peers.size
        if (expected <= connected) {
            mismatchSince = 0L
            mismatchNoted = false
            return
        }
        val now = System.currentTimeMillis()
        if (mismatchSince == 0L) mismatchSince = now
        val dur = now - mismatchSince
        if (dur > MISMATCH_NOTIFY_MS && !mismatchNoted) {
            mismatchNoted = true
            flash(
                "ほかに ${expected - connected} 人が在室していますが、まだつながっていません" +
                    if (_state.value.autoReconnect) "（つなぎ直しています）" else "（「再接続」を押すと、やり直せます）",
            )
        }
        if (_state.value.autoReconnect && dur > MISMATCH_RECONNECT_MS && now - lastAutoReconnect > AUTO_RECONNECT_GAP_MS && !reconnecting) {
            lastAutoReconnect = now
            mismatchSince = now
            mismatchNoted = false
            Runtime.scope.launch { reconnectInternal(auto = true) }
        }
    }

    /** 招待リンクで開かれた。自動では入室せず、一覧に「招待」として出す。 */
    fun setPendingKey(key: String?) {
        Runtime.scope.launch {
            pendingKey = if (isRoomKey(key)) key else null
            renderScan()
        }
    }

    fun inviteUrl(): String? = currentKey?.let { INVITE_BASE_URL + "?r=" + it }

    // ================================================================ 話題タグ

    /** 制御文字を除いて30文字までにする (Web版の capTag と同じ)。 */
    private fun capTag(t: String?): String {
        val sb = StringBuilder()
        var n = 0
        for (cp in (t ?: "").codePoints().toArray()) {
            if (cp >= 32 && cp != 127) {
                sb.appendCodePoint(cp)
                if (++n >= TAG_MAX) break
            }
        }
        return sb.toString().trim()
    }

    private fun metaJson(): JSONObject =
        JSONObject().put("tag", roomMeta.tag).put("by", roomMeta.by).put("at", roomMeta.at)

    private fun publishMeta() {
        _state.update { it.copy(roomTag = roomMeta.tag, roomTagBy = roomMeta.by) }
        announce()
        renderScan()
    }

    /** 部屋の話題タグをつける/変える (誰でも変えられ、付けた人の名前が添えられる)。空にすると消える。 */
    fun setTag(text: String) {
        Runtime.scope.launch {
            if (currentKey == null || currentKey == BOT_ROOM_KEY) return@launch // おうむ返しの部屋のタグは固定
            val t = capTag(text)
            roomMeta = Meta(t, if (t.isNotEmpty()) myNickname else "", System.currentTimeMillis())
            roomTagAction?.sendJson(metaJson())
            publishMeta()
        }
    }

    // ================================================================ 再接続

    /**
     * 通話とロビーの接続を張り直す。部屋には入ったまま (入室時刻・タグ・マイクはそのまま)。
     * 相手が見つからない、声が届かなくなったとき、回線が切り替わったときに使う。ホーム画面ではロビーだけ張り直す。
     */
    fun reconnect(auto: Boolean = false) {
        Runtime.scope.launch { reconnectInternal(auto) }
    }

    private suspend fun reconnectInternal(auto: Boolean) {
        if (reconnecting) return
        val n = net ?: return
        reconnecting = true
        _state.update { it.copy(reconnecting = true) }
        try {
            val key = currentKey
            flash(if (auto) "接続が切れた可能性があるので、つなぎ直しています…" else "再接続中…")
            if (key != null) {
                if (isTransmitting) {
                    pressed = false
                    stopTransmission()
                }
                // 古い接続を片付ける (マイクと、部屋に入っている状態はそのまま)
                room?.leave()
                room = null
                pttStateAction = null
                pttNameAction = null
                roomTagAction = null
                peers.clear()
                currentTalkerId = null
                _state.update { it.copy(ledRx = false) }
                renderPeers()
            }
            presence?.close()
            presence = null
            lobbyEntries.clear()
            renderScan()
            delay(400) // 古い部屋の後始末 (leave) が終わるのを待つ
            n.close()
            // 資格情報を取り直し、動いているリレーを選び直してから、つなぎ直す (Web版の reconnectRoom と同じ)
            turn.refresh(force = true)
            val (roomRelays, presenceRelays) = RelayList.pick(http)
            val f = factory ?: return
            val n2 = TrysteroNetwork(f, { turn.iceServers }, roomRelays, http)
            net = n2
            presenceUrls = presenceRelays
            n2.start()
            startPresence()
            if (key != null && currentKey == key) { // 待っている間に退出・移動していなければ、部屋につなぎ直す
                connectRoom(n2, key)
                renderPeers()
                announce()
            }
            renderScan()
            flash("再接続しました。相手が見つかるまで少し待ってください")
        } catch (e: Exception) {
            Runtime.log("reconnect failed: ${e.message}")
            flash("再接続に失敗しました。アプリを開き直してください")
        } finally {
            reconnecting = false
            _state.update { it.copy(reconnecting = false) }
            takeWantJoin()
        }
    }

    private fun takeWantJoin() {
        val k = wantJoin ?: return
        wantJoin = null
        joinInternal(k)
    }

    /** 回線が戻った/切り替わったときに、自動でつなぎ直す (Web版の online イベントに相当)。 */
    private fun registerNetworkWatcher() {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        var lastNet: Network? = null
        var hadLoss = false
        try {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    val changed = (lastNet != null && lastNet != network) || hadLoss
                    lastNet = network
                    hadLoss = false
                    refreshPresence() // 回線が戻ったら、部屋一覧もすぐ取り直す
                    if (changed && _state.value.autoReconnect) reconnect(auto = true)
                }

                override fun onLost(network: Network) {
                    if (network == lastNet) {
                        lastNet = null
                        hadLoss = true
                    }
                }
            })
        } catch (e: Exception) {
            Runtime.log("network watcher unavailable: ${e.message}")
        }
    }

    /** アプリが裏に回った/戻った。長く離れて戻ったときだけ、自動でつなぎ直す。 */
    fun onAppBackground() {
        hiddenAt = System.currentTimeMillis()
    }

    fun onAppForeground() {
        refreshPresence() // 画面に戻ったら、部屋一覧を取り直す (どれだけ離れていても)
        val since = hiddenAt
        hiddenAt = 0
        if (since == 0L || System.currentTimeMillis() - since < 20_000) return
        Runtime.scope.launch {
            // 通話中 (相手とつながっている) は、サービスで接続が生きているので、つなぎ直さない
            if (peers.isEmpty() && _state.value.autoReconnect) reconnectInternal(auto = true)
        }
    }

    // ================================================================ ニックネーム

    fun setNickname(text: String) {
        _state.update { it.copy(nickname = text) }
        Runtime.scope.launch { myNickname = text.trim().ifEmpty { "NoName" } }
    }

    /** 入力が終わったとき (フォーカスが外れたとき) に保存して、部屋の仲間に知らせる。 */
    fun commitNickname() {
        Runtime.scope.launch {
            persistNickname()
            pttNameAction?.sendString(myNickname)
            announce()
            renderScan()
        }
    }

    private fun persistNickname() {
        myNickname = _state.value.nickname.trim().ifEmpty { "NoName" }
        prefs.edit().putString(PREF_NAME, myNickname).apply()
    }

    // ================================================================ マイクと音声セッション

    private fun ensureMic() {
        if (audioTrack != null) {
            room?.let { r -> audioTrack?.let { r.addLocalTrack(it, STREAM_ID) } }
            return
        }
        if (!micGranted()) return
        val f = factory ?: return
        val constraints = MediaConstraints().apply {
            optional.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            optional.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            optional.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            optional.add(MediaConstraints.KeyValuePair("googHighpassFilter", "true"))
        }
        val source = f.createAudioSource(constraints)
        val track = f.createAudioTrack("pochitalk-mic", source)
        // トラックは有効のままにして、録音を動かし続ける。送信しない間は MicGain.muted で無音にする
        // (トラックを無効にすると libwebrtc が録音を止めて、押すたびに約0.4秒の起動待ちが出る)
        track.setEnabled(true)
        micGain.muted = true
        audioSource = source
        audioTrack = track
        room?.addLocalTrack(track, STREAM_ID)
    }

    private fun enterAudioSession() {
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = true
    }

    private fun exitAudioSession() {
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
        am.mode = AudioManager.MODE_NORMAL
    }

    private fun startForegroundService() {
        val key = currentKey ?: return
        // マイク種別のフォアグラウンドサービスは RECORD_AUDIO が許可されていないと開始できない
        if (micGranted()) CallService.start(app, key)
    }

    /** JavaAudioDeviceModule が録音中に呼ぶ (音声スレッド)。送信中の音量を測る。 */
    private fun onMicSamples(samples: JavaAudioDeviceModule.AudioSamples) {
        val d = samples.data
        val n = d.size / 2
        if (n == 0) return
        var sum = 0.0
        var i = 0
        while (i + 1 < d.size) {
            val v = ((d[i].toInt() and 0xff) or (d[i + 1].toInt() shl 8)).toShort().toInt()
            sum += (v * v).toDouble()
            i += 2
        }
        pushRtcRms((sqrt(sum / n) / 32768.0).toFloat())
    }

    // Web版と同じく、メーターとVOXは入力レベル (増幅) を掛けたあとの音量で見る
    private fun pushMonRms(rawRms: Float) {
        val rms = rawRms * micGain.gain
        val prev = monLevel
        monLevel = if (rms > prev) rms else prev * 0.85f + rms * 0.15f
        lastMonAt = System.currentTimeMillis()
    }

    private fun pushRtcRms(rawRms: Float) {
        val rms = rawRms * micGain.gain
        val prev = rtcLevel
        rtcLevel = if (rms > prev) rms else prev * 0.85f + rms * 0.15f
        lastRtcAt = System.currentTimeMillis()
    }

    /**
     * 部屋に入っていて、マイクが許可されていて、送信していないときだけ、待機中の音量監視を動かす。
     * 送信が始まると止める (送信中は libwebrtc が録音するため)。
     */
    private var lastMonitorCheck = 0L

    private fun setMicMuted(muted: Boolean) {
        micGain.muted = muted
    }

    /**
     * 見張り: 録音が動いている (音声フレームが来ている) のに、無音化の処理が呼ばれていないときは、
     * 送信しない間も音が漏れてしまう。その場合は、トラックを無効にして (古い方式で) 止める。
     */
    private fun checkMuteGuard(now: Long) {
        if (isTransmitting || audioTrack == null) return
        val framesFlowing = now - lastRtcAt < 300
        if (framesFlowing && now - micGain.lastProcessAt > 800) {
            Runtime.log("mute guard: processor not running while capturing -> disabling the track")
            audioTrack?.setEnabled(false)
        }
    }
    private fun updateMicMonitor() {
        // libwebrtc が録音中 (送信中、または接続直後の短い間) は、待機用の録音を止めておく。
        // 録音の停止通知が来ない場合に備えて、4秒たったら止まったものとみなす。
        val now = System.currentTimeMillis()
        // libwebrtc の録音は、部屋に相手がいる間ずっと動き続ける。動いている間は、待機用の録音を止めておく。
        // (停止の通知が来なくても、音声フレームが2秒来なければ、止まったものとみなす)
        val rtcBusy = rtcRecording && (now - rtcRecordingSince < 1_500 || now - lastRtcAt < 2_000)
        // 相手がいない部屋 (libwebrtc が録音しない) で話しているときも、レベルメーターが振れるように、待機用の録音を続ける
        val want = (room != null || micTest) && micGranted() && (!isTransmitting || peers.isEmpty()) && !rtcBusy
        if (want) micMonitor.start() else micMonitor.stop()
    }

    private var rtcRecording = false
    private var txEndedAt = 0L
    private var rtcRecordingSince = 0L

    /** libwebrtc の録音が始まった/止まった。止まったら待機用の録音を再開する。 */
    private fun onRtcRecording(active: Boolean) {
        Runtime.log("webrtc recording " + if (active) "start" else "stop")
        rtcRecording = active
        if (active) rtcRecordingSince = System.currentTimeMillis()
        if (active) micMonitor.stopAndWait() // 先に待機用が走っていたら、競合する前に解放する
        updateMicMonitor()
    }

    // ================================================================ 話す (PTT)

    fun pttPress() {
        Runtime.scope.launch {
            pressed = true
            startTransmission(quiet = false)
        }
    }

    /** スワイプと判定した: 送信中なら、終了音を鳴らさずにすぐ止める。 */
    fun pttAbort() {
        Runtime.scope.launch {
            pressed = false
            stopTransmission(quiet = true)
        }
    }

    fun pttRelease() {
        Runtime.scope.launch {
            pressed = false
            stopTransmission()
        }
    }

    private fun othersTalking() = peers.values.count { it.talking }

    private fun startTransmission(quiet: Boolean) {
        if (isTransmitting) return
        if (room == null) return flash("先に部屋に入ってください")
        if (othersTalking() > 0) {
            // 他の人が話している間は割り込めない
            if (!quiet) {
                sounds.playBusy()
                flash("話中です")
            }
            return
        }
        if (!micGranted()) {
            flash("マイクの許可が必要です")
            _events.tryEmit(UiEvent.RequestMic)
            return
        }
        ensureMic()
        val track = audioTrack ?: return flash("マイクを準備できませんでした")
        if (!pressed) return
        isTransmitting = true
        micMonitor.stopAndWait() // 録音を1つずつにするため、送信を始める前に待機用を解放する
        track.setEnabled(true) // (見張りで無効にされていた場合に備えて)
        setMicMuted(false)
        setStatus(StatusKind.TX, "TX (送信中)", ledTx = true, ledRx = _state.value.ledRx)
        sounds.playStart()
        pttStateAction?.sendJson(JSONObject().put("isTalking", true))
        announce()
        renderScan()
    }

    private fun stopTransmissionSilently() {
        if (!isTransmitting) return
        isTransmitting = false
        txEndedAt = System.currentTimeMillis()
        setMicMuted(true)
        updateMicMonitor()
        _state.update { it.copy(ledTx = false) }
        pttStateAction?.sendJson(JSONObject().put("isTalking", false))
        announce()
        renderScan()
    }

    private fun stopTransmission(quiet: Boolean = false) {
        if (!isTransmitting) return
        isTransmitting = false
        txEndedAt = System.currentTimeMillis()
        setMicMuted(true)
        updateMicMonitor()
        val talker = currentTalkerId?.let { peers[it] }
        if (talker != null) {
            onStartReceiving(talker.name)
        } else {
            setStatus(StatusKind.STANDBY, "STANDBY", ledTx = false, ledRx = false)
        }
        _state.update { it.copy(ledTx = false) }
        if (!quiet) sounds.playEnd()
        pttStateAction?.sendJson(JSONObject().put("isTalking", false))
        announce()
        renderScan()
    }

    private fun onPttState(peerId: String, talking: Boolean) {
        val peer = peers[peerId]
        Runtime.log("pttState from ${peerId.take(5)} talking=$talking")
        if (peer != null) peer.talking = talking
        if (talking) {
            rx.onTalkStart(peerId)
            currentTalkerId = peerId
            if (isTransmitting) {
                // ほぼ同時に話し始めた: お互いの送信が切れて混線
                pressed = false
                stopTransmissionSilently()
                showCrosstalk()
                flash("混線！ もう一度押してください")
            } else if (othersTalking() >= 2) {
                showCrosstalk()
            } else {
                onStartReceiving(peer?.name ?: "相手")
            }
        } else if (currentTalkerId == peerId) {
            onStopReceiving()
        }
        renderPeers()
    }

    private fun onStartReceiving(name: String) {
        setStatus(StatusKind.RX, "RX: $name", ledTx = _state.value.ledTx, ledRx = true)
    }

    private fun onStopReceiving() {
        currentTalkerId = null
        _state.update { it.copy(ledRx = false) }
        if (!isTransmitting) {
            setStatus(StatusKind.STANDBY, "STANDBY", ledTx = false, ledRx = false)
            sounds.playEnd()
        }
    }

    private fun showCrosstalk() {
        sounds.playCrosstalk()
        setStatus(StatusKind.CROSSTALK, "混線！", ledTx = false, ledRx = _state.value.ledRx)
        crosstalkJob?.cancel()
        crosstalkJob = Runtime.scope.launch {
            delay(1300)
            if (!isTransmitting && currentTalkerId == null) {
                setStatus(StatusKind.STANDBY, "STANDBY", ledTx = false, ledRx = false)
            }
        }
    }

    private fun resetStatus() {
        setStatus(StatusKind.STANDBY, "STANDBY", ledTx = false, ledRx = false)
    }

    private fun setStatus(kind: StatusKind, text: String, ledTx: Boolean, ledRx: Boolean) {
        _state.update { it.copy(status = kind, statusText = text, ledTx = ledTx, ledRx = ledRx) }
    }

    private fun renderPeers() {
        val list = peers.map { (id, p) -> PeerInfo(id, p.name, p.talking) }
        _state.update { it.copy(peers = list) }
        updateCounts()
    }

    /** 参加者一覧の「接続 N / 在室 M」: N = 実際につながっている人 + 自分、M = 部屋一覧 (Nostr) の人数 (N 未満にはしない)。 */
    private fun updateCounts() {
        val cur = currentKey
        if (cur == null || room == null) {
            _state.update { if (it.connectedCount == 0 && it.presentCount == 0) it else it.copy(connectedCount = 0, presentCount = 0) }
            return
        }
        // Web版の updatePeerCount と同じ: 一覧 (Nostr) で見える人と、実際につながっている人を、名前でまとめて数える。
        // 一覧の人数は、ダイヤルと同じ (一覧の人 + 自分)。
        val n = peers.size + 1
        val inLobby = lobbyEntries.values.filter { it.key == cur }
        val names = HashSet<String>()
        names.add(myNickname.take(12))
        peers.forEach { (id, p) -> names.add((p.name.ifEmpty { id.take(5) }).take(12)) }
        inLobby.forEach { names.add(it.name.take(12)) }
        val m = maxOf(names.size, inLobby.size + 1, n)
        _state.update { if (it.connectedCount == n && it.presentCount == m) it else it.copy(connectedCount = n, presentCount = m) }
    }

    /** 自動で再接続するか (標準はオフ)。オフでも、手動の「再接続」とマイクの取り直しは今までどおり。 */
    fun setAutoReconnect(on: Boolean) {
        _state.update { it.copy(autoReconnect = on) }
        if (on) prefs.edit().putString(PREF_AUTO_RECONNECT, "1").apply() else prefs.edit().remove(PREF_AUTO_RECONNECT).apply()
    }

    private fun flash(text: String) {
        _state.update { it.copy(flash = text) }
        flashJob?.cancel()
        flashJob = Runtime.scope.launch {
            delay(2_500)
            _state.update { it.copy(flash = null) }
        }
    }

    // ================================================================ 設定 / VOX

    /** 入力レベル (マイクの増幅)。声が小さく伝わる端末で上げる。0〜30 dB。 */
    fun setMicGainDb(db: Int) {
        val v = db.coerceIn(0, 30)
        micGain.gain = Math.pow(10.0, v / 20.0).toFloat()
        _state.update { it.copy(micGainDb = v) }
        prefs.edit().putInt(PREF_MIC_GAIN, v).apply()
    }

    /** 初回案内を表示するか。Web版と同じく、オフにしたときだけ "off" を保存する。 */
    fun setWelcomeOn(on: Boolean) {
        _state.update { it.copy(welcomeOn = on) }
        if (on) prefs.edit().remove(PREF_WELCOME).apply() else prefs.edit().putString(PREF_WELCOME, "off").apply()
    }

    /**
     * 設定のマイクテスト。入室しなくても、入力レベルとメーターを確認できる。
     * 音は送信も保存もしない。設定を閉じたら止める。
     */
    fun setMicTest(on: Boolean) {
        Runtime.scope.launch {
            if (on) {
                if (room != null) return@launch
                if (!micGranted()) {
                    flash("マイクの許可が必要です")
                    _events.tryEmit(UiEvent.RequestMic)
                    return@launch
                }
            }
            micTest = on
            _state.update { it.copy(micTest = on) }
            updateMicMonitor()
        }
    }

    /** 効果音の音量 (0〜150%)。0 にすると消える。Web版と同じ。 */
    fun setSfxVolume(percent: Int) {
        val v = percent.coerceIn(0, 150)
        sounds.volume = v / 100f
        _state.update { it.copy(sfxVolume = v) }
        prefs.edit().putInt(PREF_SFX_VOL, v).apply()
    }

    /** スライダーを離したときの試し聴き (「ガッ」)。 */
    fun previewSfx() {
        sounds.playEnd()
    }

    /** 左手用: VOX ボタンを話すボタンの右側に置く。オンにしたときだけ保存する。 */
    fun setLefty(on: Boolean) {
        _state.update { it.copy(lefty = on) }
        if (on) prefs.edit().putString(PREF_LEFTY, "1").apply() else prefs.edit().remove(PREF_LEFTY).apply()
    }

    /** 話すボタンの位置 (左 / 中央 / 右)。中央以外のときだけ保存する。 */
    fun setPttPosition(pos: PttPosition) {
        _state.update { it.copy(pttPos = pos) }
        when (pos) {
            PttPosition.LEFT -> prefs.edit().putString(PREF_PTT_POS, "left").apply()
            PttPosition.RIGHT -> prefs.edit().putString(PREF_PTT_POS, "right").apply()
            PttPosition.CENTER -> prefs.edit().remove(PREF_PTT_POS).apply()
        }
    }

    /** スピーカーのミュート切り替え (相手の声と効果音を止める。マイクは止めない)。 */
    fun toggleSpeakerMute() {
        Runtime.scope.launch {
            val muted = !_state.value.speakerMuted
            audioModule?.setSpeakerMute(muted)
            sounds.muted = muted
            _state.update { it.copy(speakerMuted = muted) }
            flash(if (muted) "スピーカーをミュートしました" else "スピーカーのミュートを解除しました")
        }
    }


    /**
     * 1〜10の値が大きいほど、大きな声が必要になる (Web版と同じ向き)。
     * 機種でマイクの入力レベルが4〜10倍違う (実機: Pixel の話し声は 0.02〜0.09、Galaxy は 0.005〜0.014) ので、
     * 0.0015〜0.04 を対数目盛り (1段あたり約1.44倍) にして、どちらの端末でも合わせられるようにしている。
     */
    private fun voxThreshold(): Float =
        (0.0015 * Math.pow(1.44, (_state.value.voxSens - 1).toDouble())).toFloat()

    /** VOXメーター用: 音量を dB (-60〜-20dB) で 0..1 にする。小さい音も見えるように対数にしている。 */
    private fun voxMeterFraction(level: Float): Float {
        if (level <= 1e-5f) return 0f
        val db = 20.0 * Math.log10(level.toDouble())
        return ((db + 60.0) / 40.0).coerceIn(0.0, 1.0).toFloat()
    }

    fun setVoxSensitivity(sens: Int) {
        val v = sens.coerceIn(1, 10)
        _state.update { it.copy(voxSens = v) }
        _state.update { it.copy(voxThreshold = voxMeterFraction(voxThreshold())) }
        prefs.edit().putInt(PREF_VOX_THR, v).apply()
    }

    fun setVox(on: Boolean) {
        Runtime.scope.launch {
            if (on) {
                if (!micGranted()) {
                    flash("マイクの許可が必要です")
                    _events.tryEmit(UiEvent.RequestMic)
                    return@launch
                }
                ensureMic()
                _state.update { it.copy(voxOn = true) }
                voxHits = 0
                voxJob?.cancel()
                voxJob = launch {
                    while (isActive) {
                        voxTick()
                        delay(50)
                    }
                }
            } else {
                stopVoxInternal()
            }
        }
    }

    private fun stopVoxInternal() {
        voxJob?.cancel()
        voxJob = null
        if (voxInitiated && isTransmitting) {
            pressed = false
            stopTransmission()
        }
        voxInitiated = false
        _state.update { it.copy(voxOn = false, voxLevel = 0f) }
    }

    private fun voxTick() {
        val now = System.currentTimeMillis()
        val lvl = currentMicLevel(now) ?: 0f
        val thr = voxThreshold()
        _state.update { it.copy(voxLevel = voxMeterFraction(lvl), voxThreshold = voxMeterFraction(thr)) }
        if (room == null) {
            voxHits = 0
            return
        }
        if (!isTransmitting) {
            voxInitiated = false
            // 他の人が話している間は割り込まない
            if (lvl > thr && othersTalking() == 0 && now > voxCooldownUntil) {
                if (++voxHits >= 3) {
                    voxHits = 0
                    voxInitiated = true
                    voxLastVoice = now
                    pressed = true
                    startTransmission(quiet = true)
                }
            } else if (lvl <= thr) {
                voxHits = 0
            }
        } else if (voxInitiated) {
            if (lvl > thr * VOX_HOLD_RATIO) {
                voxLastVoice = now
            } else if (now - voxLastVoice > VOX_HOLD_MS) {
                pressed = false
                voxInitiated = false
                stopTransmission()
                voxCooldownUntil = System.currentTimeMillis() + VOX_COOLDOWN_MS
            }
        }
    }

    // ================================================================ 音量レベルメーター

    /**
     * 送信中は自分のマイク (TX)、誰かが話していればその音声 (RX)、それ以外はマイク待機 (MIC)。
     * マイクの音量は録音中だけ取れる (誰かと接続して音声トラックが付いているとき)。
     */
    private fun meterTick() {
        if (room == null && !micTest) {
            if (_meter.value != MeterState()) {
                meterLevel = 0f
                meterPeak = 0f
                _meter.value = MeterState()
            }
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastMonitorCheck >= 500) {
            lastMonitorCheck = now
            updateMicMonitor()
            checkMuteGuard(now)
        }
        val micNow = currentMicLevel(now)
        var label = "LEVEL"
        var rms: Double? = null
        val talker = currentTalkerId
        if (isTransmitting) {
            label = "TX"
            if (micNow != null) rms = micNow.toDouble()
        } else if (talker != null) {
            label = "RX"
            pollRxLevel(talker, now)
            rms = rxLevel
        } else if (micNow != null) {
            label = "MIC"
            rms = micNow.toDouble()
        }
        val db = if (rms != null && rms > 1e-5) 20.0 * Math.log10(rms) else Double.NEGATIVE_INFINITY
        val target = if (db.isFinite()) ((db + 60.0) / 60.0).coerceIn(0.0, 1.0).toFloat() else 0f
        // Web版は60fps前提の係数 (上がり0.5 / 下がり0.12 / ピーク減衰0.02) を、50ms刻みに換算している
        meterLevel += (target - meterLevel) * (if (target > meterLevel) 0.875f else 0.32f)
        if (meterLevel >= meterPeak) {
            meterPeak = meterLevel
            meterPeakHoldUntil = now + 800
        } else if (now > meterPeakHoldUntil) {
            meterPeak = maxOf(meterLevel, meterPeak - 0.06f)
        }
        _meter.value = MeterState(
            label = label,
            level = meterLevel,
            peak = meterPeak,
            dbText = if (db.isFinite()) Math.round(db).toString() + " dB" else "-∞ dB",
        )
    }

    private fun pollRxLevel(peerId: String, now: Long) {
        if (rxPolling || now - rxPolledAt < RX_POLL_INTERVAL_MS) return
        rxPolling = true
        rxPolledAt = now
        room?.fetchInboundAudioLevel(peerId) { level ->
            rxPolling = false
            rxLevel = level ?: 0.0
        } ?: run { rxPolling = false }
    }
}
