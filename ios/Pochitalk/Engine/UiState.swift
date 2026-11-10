import Foundation

/// 部屋一覧の1行。
struct RoomInfo: Identifiable, Equatable {
    var key: String
    var count: Int
    var air: Bool
    var names: [String]
    var invited: Bool
    var isCurrent: Bool
    /// 話題タグと、付けた人の名前 (なければ空)。
    var tag = ""
    var tagBy = ""
    var id: String { key }
}

struct PeerInfo: Identifiable, Equatable {
    var id: String
    var name: String
    var talking: Bool
}

enum StatusKind { case standby, tx, rx, crosstalk }

/// 話すボタンを置く位置 (設定で選ぶ)。中央が標準。
enum PttPosition: String { case left, center, right }

/// 液晶の音量レベルメーター (Web 版の LEVEL / MIC / TX / RX 表示)。
struct MeterState: Equatable {
    var label = "LEVEL"
    var level: Float = 0
    var peak: Float = 0
    var dbText = "-∞ dB"
}

struct UiState: Equatable {
    var ready = false
    var nickname = ""
    /// 入室中の部屋ハッシュ (8桁の16進)。nil ならホーム画面。
    var currentKey: String?
    /// 招待リンクで指定された部屋 (まだ入室していない)。
    var pendingKey: String?
    var rooms: [RoomInfo] = []
    var totalPeople = 0
    var peers: [PeerInfo] = []
    var status: StatusKind = .standby
    var statusText = "STANDBY"
    var ledTx = false
    var ledRx = false
    var flash: String?
    var voxOn = false
    var voxSens = 4
    var voxLevel: Float = 0
    var voxThreshold: Float = 0
    /// 効果音の音量 (0〜150%)。0 で消える。
    var sfxVolume = 100
    var lefty = false
    var pttPos: PttPosition = .center
    /// スピーカーのミュート (相手の声と効果音を止める。マイクは止めない)。
    var speakerMuted = false
    /// 入力レベル (マイクの増幅)。0〜30 dB。
    var micGainDb = 0
    /// 設定のマイクテスト中 (入室していなくても入力レベルとメーターを確認できる)。
    var micTest = false
    var welcomeOn = true
    /// 新しい部屋ができたら、音で知らせる
    var notifyRoom = false
    /// 通信の記録を、この端末に残す (オンの間は、名前の前に 💾 が付く)
    var logRec = false
    var roomTag = ""
    var roomTagBy = ""
    /// 受信中のモールスを読んだ文字 (液晶に出す)。
    var rxText = ""
    /// モールスの送信待ちの文字 (キーボードの見出しに出す)
    var morseText = ""
    /// FAX モードで打っている文字 (FAX モードでなければ nil)
    var faxCompose: String?
    /// 自動で再接続する (標準はオフ。手動の「再接続」ボタンは、オフでも使える)。
    var autoReconnect = false
    /// 接続 N (実際につながっている人数 + 自分) / 在室 M (在室の一覧の人数。N 未満にはしない)。
    var connN = 0
    var connAudio = 0
    /// ロビー(一覧)にはいるのに、まだ音声がつながっていない人の名前 (つながったら消える)
    var missingNames: [String] = []
    var connM = 0
    /// 受信した FAX の紙 (なければ nil)。
    var faxPaper: FaxPaper?
    /// 再接続の途中 (ボタンを押せなくする)。
    var reconnecting = false
    var micPermission: MicPermission = .undetermined
    /// 音声ユニットが動いているか (ロック中も動き続けているかの目安)。
    var audioRunning = false
}

enum MicPermission { case undetermined, granted, denied }

func formatKey(_ key: String) -> String { key.prefix(4).uppercased() + "·" + key.dropFirst(4).uppercased() }

/// 部屋番号: 小文字の a〜z と 0〜9 の 8 文字 (36 種類)。16 進の古い部屋も、そのまま通る。大文字は、呼ぶ側で小文字にそろえる。
func isRoomKey(_ s: String?) -> Bool {
    guard let s, s.utf8.count == 8 else { return false }
    return s.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x7A) }
}

/// おうむ返しボットの部屋 (Web 版の BOT_ROOM_KEY)。一覧の先頭に出す。
let botRoomKey = "22360679"
/// 旧いおうむの部屋 (古い版の人が来るので、しばらく残す)。一覧には、人がいるときだけ、新しい部屋の次に出る。
let botRoomOld = "7a0b07c1"
/// おうむ返しの部屋か (新旧どちらでも真)。🦜 の印、固定のタグ、新しい部屋の音を鳴らさない、などに使う。
func isBotRoom(_ key: String?) -> Bool { key == botRoomKey || key == botRoomOld }
