package app.pochitalk.engine

/** 部屋一覧の1行 (ホーム画面・無線機画面の下に表示)。 */
data class RoomInfo(
    val key: String,
    val count: Int,
    val air: Boolean,
    val names: List<String>,
    val invited: Boolean,
    val isCurrent: Boolean,
    /** 話題タグと、付けた人の名前 (なければ空)。 */
    val tag: String = "",
    val tagBy: String = "",
    /** 部屋を開いた時刻 (エポックms)。不明・無人は0。 */
    val openAt: Long = 0L,
)

/** 経過時間の表示 (Web版の fmtElapsed)。 */
fun fmtElapsed(ms: Long): String {
    val m = (ms / 60_000L).coerceAtLeast(0)
    return when {
        m < 1 -> "いま開いたばかり"
        m < 60 -> "${m}分"
        m < 1440 -> "${m / 60}時間${m % 60}分"
        else -> "${m / 1440}日${(m % 1440) / 60}時間"
    }
}

data class PeerInfo(val id: String, val name: String, val talking: Boolean)

enum class StatusKind { STANDBY, TX, RX, CROSSTALK }

/** 話すボタンを置く位置 (設定で選ぶ)。中央が標準。 */
enum class PttPosition { LEFT, CENTER, RIGHT }

/** 液晶の音量レベルメーター (Web版の LEVEL / MIC / TX / RX 表示)。 */
data class MeterState(
    val label: String = "LEVEL",
    val level: Float = 0f,
    val peak: Float = 0f,
    val dbText: String = "-∞ dB",
)

data class UiState(
    val ready: Boolean = false,
    val nickname: String = "",
    /** 入室中の部屋ハッシュ (8桁の16進)。null ならホーム画面。 */
    val currentKey: String? = null,
    /** 招待リンクで指定された部屋 (まだ入室していない)。 */
    val pendingKey: String? = null,
    val rooms: List<RoomInfo> = emptyList(),
    val totalPeople: Int = 0,
    val peers: List<PeerInfo> = emptyList(),
    val status: StatusKind = StatusKind.STANDBY,
    val statusText: String = "STANDBY",
    val ledTx: Boolean = false,
    val ledRx: Boolean = false,
    val flash: String? = null,
    val voxOn: Boolean = false,
    val voxSens: Int = 4,
    val voxLevel: Float = 0f,
    val voxThreshold: Float = 0f,
    /** 効果音の音量 (0〜150%)。0 で消える。 */
    val sfxVolume: Int = 100,
    /** 左手用: VOX ボタンを話すボタンの右側に置く。 */
    val lefty: Boolean = false,
    /** 話すボタンの位置 (左 / 中央 / 右)。Android 版の設定。 */
    val pttPos: PttPosition = PttPosition.CENTER,
    /** スピーカーのミュート (相手の声と効果音を止める。マイクは止めない)。 */
    val speakerMuted: Boolean = false,
    /** 入力レベル (マイクの増幅)。0〜30 dB。 */
    val micGainDb: Int = 0,
    /** 設定のマイクテスト中 (入室していなくても入力レベルとメーターを確認できる)。 */
    val micTest: Boolean = false,
    /** 起動時に初回案内を表示するか。 */
    val welcomeOn: Boolean = true,
    /** 入室中の部屋の話題タグ。 */
    val roomTag: String = "",
    val roomTagBy: String = "",
    /** 再接続の途中 (ボタンを押せなくする)。 */
    val reconnecting: Boolean = false,
    val micGranted: Boolean = false,
    /** 受信したモールスを読んだ文字列 (Web版の液晶の下の行)。空なら何も出さない。 */
    val morseText: String = "",
    val morseFrom: String = "",
    /** 受信した FAX の紙。null なら出さない。 */
    val fax: FaxPaper? = null,
    /** 自動で再接続する (設定。標準はオフ)。 */
    val autoReconnect: Boolean = false,
    /** 「接続 N / 在室 M」。N = つながっている人 + 自分、M = 部屋一覧の人数 (N 未満にはしない)。入室していなければ 0。 */
    val connectedCount: Int = 0,
    /** 一覧 (ロビー) にはいるが、まだ音声がつながっていない人の名前 (先頭 12 文字)。つながったら消える。 */
    val missingNames: List<String> = emptyList(),
    /** 新しい部屋ができたら音で知らせる (初期オフ)。 */
    val notifyRoom: Boolean = false,
    /** 通信の記録を端末に残す (初期オフ)。オンの間は名前の前に 💾 が付く。 */
    val logMode: Boolean = false,
    /** 利用上の注意に同意済みか (同意した版が、いまの版と同じ)。 */
    val consentOk: Boolean = true,
    /** モールス送信の待ち行列 (まだ送っていない文字) と、送信中か。 */
    val morseQueued: String = "",
    val morseSending: Boolean = false,
    /** FAXモード (隠し): 「fax」と打つと入る。打った文字と、ESC で出る。 */
    val faxMode: Boolean = false,
    val faxText: String = "",
    /** 音声が通っている人数 (自分を含む)。「接続」より少ないときだけ、バッジに「（音声OK k）」を足す。 */
    val audioOkCount: Int = 0,
    /** つながりの順位で、自分が「入り直す番」か (Web版の linkRanking)。 */
    val rejoinTurn: Boolean = false,
    val presentCount: Int = 0,
)

/** UI (Activity) に頼む一回限りの操作。 */
sealed interface UiEvent {
    /** マイク権限のリクエストを出してほしい。 */
    data object RequestMic : UiEvent
}

fun formatKey(key: String): String = key.take(4).uppercase() + "·" + key.drop(4).uppercase()

/** 部屋番号: 小文字の a〜z・0〜9 の 8 桁 (16進だけだった旧い部屋も、そのまま通る)。 */
fun isRoomKey(s: String?): Boolean = s != null && Regex("^[0-9a-z]{8}$").matches(s)

/** 受信中の FAX の紙 (Web版と同じ 15 行。[shownRows] 行目まで出ている)。黒い画素は [black] (行 × 列)。 */
class FaxPaper(val cols: Int, val black: BooleanArray, val shownRows: Int, val from: String)

/** おうむ返しの部屋か (新旧どちらの番号でも真)。🦜 の印・固定のタグ・先頭表示・新しい部屋の音を鳴らさない、に使う。 */
fun isBotRoom(k: String?): Boolean = k == PochiEngine.BOT_ROOM_KEY || k == PochiEngine.BOT_ROOM_OLD
