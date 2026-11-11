import Foundation

/// モールス符号の表 (Web 版 MORSE_CODE と同じ)。
let morseCode: [Character: String] = [
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.", "G": "--.", "H": "....", "I": "..", "J": ".---",
    "K": "-.-", "L": ".-..", "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.", "S": "...", "T": "-",
    "U": "..-", "V": "...-", "W": ".--", "X": "-..-", "Y": "-.--", "Z": "--..",
    "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.", "0": "-----",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "/": "-..-.", "-": "-....-", ":": "---...", "'": ".----.",
    "\"": ".-..-.", "(": "-.--.", ")": "-.--.-", "=": "-...-", "+": ".-.-.", "@": ".--.-.",
]

/// モールスの受信 (Web 版 decodeMorseRx の移植)。700Hz の純音の長短と間隔を測って、文字に戻す。
/// RT.queue 上で使う。
final class MorseDecoder {
    static let unit = 100.0
    private static let reverse: [String: Character] = {
        var r: [String: Character] = [:]
        for (k, v) in morseCode { r[v] = k }
        return r
    }()

    /// 液晶に出す文字列 (確定した文字 + 組み立て中の符号)。
    var onRender: ((String) -> Void)?
    /// 「ESC」を受けた (FAX の紙を隠す合図)。
    var onEsc: (() -> Void)?

    private var pat = "", text = ""
    private var tone = false, hasPend = false, letterDone = false, wordDone = false
    private var pendDur = 0.0, pendEnd = 0.0, toneAt = 0.0, offAt = 0.0

    func reset() {
        pat = ""; text = ""; tone = false; hasPend = false; pendDur = 0; letterDone = false; wordDone = false
        onRender?("")
    }

    /// 話し終わってしばらくしたら呼ぶ: 組み立て中の符号を確定して見せる。
    func flush() {
        if tone { return }
        finalizePend()
        if !pat.isEmpty { flushChar(); render() }
    }

    func process(_ b: ToneMeter.Block) {
        let now = b.t
        let isTone = b.rms >= (tone ? 0.0012 : 0.002) && b.pure >= (tone ? 0.5 : 0.6)
        // 無音で、保留中の符号もないときは何もしない
        if !tone && !hasPend && pat.isEmpty && !(letterDone && !wordDone) && !isTone { return }
        let u = Self.unit
        if isTone {
            if !tone {
                tone = true; toneAt = now
                if hasPend && now - pendEnd >= 30 { finalizePend() } // 30ms以上あいたら前の符号は確定
                // 次の符号の始まりで、前の文字との区切りを実測の無音長で確定する
                if !hasPend && offAt > 0 && (!pat.isEmpty || letterDone) && !wordDone {
                    let gap = now - offAt
                    if gap >= u * 5 {
                        if !pat.isEmpty { flushChar() }
                        text = String((text + " ").suffix(60))
                        render()
                    } else if !pat.isEmpty && gap >= u * 2 + 5 {
                        flushChar(); render()
                    }
                }
                letterDone = false; wordDone = false
            }
        } else {
            if tone {
                tone = false
                let seg = now - toneAt
                if seg >= 35 { // 35ms未満のクリック等のノイズは捨てる
                    if hasPend { pendDur += (toneAt - pendEnd) + seg } // 短い欠落はつないで1つの符号にする
                    else { pendDur = seg; hasPend = true }
                    pendEnd = now
                }
            }
            if hasPend && now - pendEnd >= 30 { finalizePend() }
            if !hasPend && (!pat.isEmpty || (letterDone && !wordDone)) {
                let silence = now - offAt
                if silence >= u * 5 && !wordDone {
                    if !pat.isEmpty { flushChar() }
                    text = String((text + " ").suffix(60))
                    wordDone = true; letterDone = true
                    render()
                } else if !pat.isEmpty && silence >= u * 2 + 5 && !letterDone {
                    flushChar()
                    letterDone = true
                    render()
                }
            }
        }
    }

    private func finalizePend() {
        guard hasPend else { return }
        pat += pendDur < Self.unit * 2 ? "." : "-"
        hasPend = false; pendDur = 0
        offAt = pendEnd
        render()
    }

    private func flushChar() {
        guard !pat.isEmpty else { return }
        if let hit = Self.reverse[pat] {
            text.append(hit)
        } else {
            // 完全一致が無くても、1要素違いの候補が1つだけなら推定して読む
            var cand: Character?, ties = 0
            for (p, c) in Self.reverse where Self.dist1(pat, p) { cand = c; ties += 1 }
            if ties == 1, let c = cand {
                text += c.isLetter ? String(c).lowercased() : String(c) + "?" // 推定は目印付き
            } else {
                text += "[" + Self.dots(pat) + "]" // 読めなかった符号は測れた形のまま出す
            }
        }
        text = String(text.suffix(60))
        if text.hasSuffix("ESC") { onEsc?() }
        pat = ""
    }

    private func render() {
        var s = text
        var cur = pat
        if hasPend { cur += pendDur < Self.unit * 2 ? "." : "-" }
        if !cur.isEmpty { s += (s.isEmpty ? "" : " ") + Self.dots(cur) }
        onRender?(s.count > 38 ? String(s.suffix(38)) : s)
    }

    private static func dots(_ p: String) -> String { String(p.map { $0 == "." ? "・" : "−" }) }

    /// 2つの符号が「1要素だけ違う」か。
    static func dist1(_ a: String, _ b: String) -> Bool {
        if a == b { return false }
        let x = Array(a), y = Array(b)
        if abs(x.count - y.count) > 1 { return false }
        if x.count == y.count { return zip(x, y).filter { $0 != $1 }.count == 1 }
        let s = x.count < y.count ? x : y, l = x.count < y.count ? y : x
        var i = 0, j = 0, skipped = false
        while i < s.count && j < l.count {
            if s[i] == l[j] { i += 1; j += 1 } else { if skipped { return false }; skipped = true; j += 1 }
        }
        return true
    }
}

// ================================================================ FAX

/// FAX の紙 (240×15 の白黒)。Web 版の faxCanvas に相当する。
struct FaxPaper: Equatable {
    static let cols = 240
    static let rows = 15
    var pixels = [UInt8](repeating: 0, count: cols * rows) // 1 = 黒
}

/// FAX の受信。中身はデータ便 (`faxPage`) で確実に届き、見せ方は音の FAX のまま (ピーが聞こえたら、1行ずつ出す)。
/// RT.queue 上で使う。
final class FaxReceiver {
    static let textRows = 14
    static let pxMs = 20.0

    var onPaper: ((FaxPaper?) -> Void)?

    private final class Page {
        let grid: [[Bool]]
        var started = false
        var jobs: [Job] = []
        init(grid: [[Bool]]) { self.grid = grid }
        func cancel() { jobs.forEach { $0.cancel() }; jobs = [] }
    }

    private var pages: [String: Page] = [:]
    private var preCount = 0
    private var paper = FaxPaper()

    /// 紙を隠す (「ESC」を受けたとき、退室したとき)。
    func hide() {
        audioActive = false
        pages.values.forEach { $0.cancel() }
        pages = [:]
        onPaper?(nil)
    }

    /// データ便を受けた。音のピーが聞こえればそちらで始め、聞こえなくても少し待って始める。
    func onPage(peerId: String, json: [String: Any]) {
        guard let grid = Self.payloadToGrid(json) else { return }
        pages[peerId]?.cancel()
        let page = Page(grid: grid)
        pages[peerId] = page
        page.jobs.append(RT.after(1500) { [self] in start(peerId, page, delay: 0) })
    }

    func process(_ b: ToneMeter.Block) {
        if audioActive { audioStep(b); return }
        if b.fax == 1 {
            preCount += 1
            if preCount >= 8 { // 120ms以上のピー: 受信開始の合図
                preCount = 0
                if pages.isEmpty { beginAudio(b) } // データ便が来ていない (おうむ返しなど、音だけ) ときは、音を読み取って描く
                else { for (id, p) in pages where !p.started { start(id, p, delay: 500) } }
            }
        } else { preCount = 0 }
    }

    // ---- 音だけの FAX (データ便なし): トーンの並びから、紙を描く。
    // 送信側の進行表: ピー(1500) → 各行 [同期(900) 150ms → 白(1300)/黒(2100) を 1 ピクセル 20ms で並べる (空行は白 80ms)]。最初の行は余白。
    private var audioActive = false
    private var curTone: UInt8 = 0
    private var segStart = 0.0
    private var lastT = 0.0
    private var rowY = -1
    private var rowT0: Double?
    private var silentBlocks = 0
    private var cur = [UInt8](repeating: 0, count: FaxPaper.cols)

    private func beginAudio(_ b: ToneMeter.Block) {
        audioActive = true
        paper = FaxPaper()
        onPaper?(paper)
        curTone = 1; segStart = b.t; lastT = b.t
        rowY = -1; rowT0 = nil; silentBlocks = 0
        cur = [UInt8](repeating: 0, count: FaxPaper.cols)
    }

    private func audioStep(_ b: ToneMeter.Block) {
        lastT = b.t
        let tone = b.fax
        if tone == 0 {
            silentBlocks += 1
            if silentBlocks >= 40 { finishAudio() } // 0.6 秒の無音で、受信おわり
            return
        }
        silentBlocks = 0
        if tone == curTone { return }
        closeSegment(end: b.t)
        if tone == 2 { rowY += 1; rowT0 = nil; cur = [UInt8](repeating: 0, count: FaxPaper.cols) } // 同期: 次の行へ (音のズレは、そのまま絵に出す)
        else if (tone == 3 || tone == 4) && curTone == 2 { rowT0 = b.t } // 同期のあと、最初の白/黒: 行のデータの始まり
        curTone = tone; segStart = b.t
    }

    private func closeSegment(end: Double) {
        guard (curTone == 3 || curTone == 4), let t0 = rowT0, rowY >= 0, rowY < FaxPaper.rows else { return }
        if curTone == 4 {
            let x0 = max(0, Int(((segStart - t0) / Self.pxMs).rounded())), x1 = min(FaxPaper.cols, Int(((end - t0) / Self.pxMs).rounded()))
            if x1 > x0 { for x in x0..<x1 { cur[x] = 1 } }
        }
        for x in 0..<FaxPaper.cols { paper.pixels[rowY * FaxPaper.cols + x] = cur[x] }
        onPaper?(paper)
    }

    private func finishAudio() {
        closeSegment(end: lastT - Double(silentBlocks) * ToneMeter.blockMs)
        audioActive = false
        curTone = 0
    }

    private func start(_ peerId: String, _ page: Page, delay: Int) {
        guard pages[peerId] === page, !page.started else { return }
        page.started = true
        page.jobs.forEach { $0.cancel() }
        page.jobs = []
        paper = FaxPaper()
        onPaper?(paper)
        // 送信側と同じ進行表で1行ずつ出す: 空行 (同期+短い白) → 本文行 (同期+幅ぶん)。真っ白な行は速い
        let cols = page.grid.first?.count ?? 0
        var at = delay
        func schedule(_ row: [Bool]?, _ y: Int, _ dur: Int) {
            page.jobs.append(RT.after(at) { [self] in
                guard pages[peerId] === page else { return }
                if let row { for x in 0..<min(cols, FaxPaper.cols) where row[x] { paper.pixels[y * FaxPaper.cols + x] = 1 } }
                onPaper?(paper)
            })
            at += dur
        }
        schedule(nil, 0, 150 + 80)
        for y in 0..<Self.textRows {
            let row = page.grid[y]
            let blank = !row.contains(true)
            schedule(row, 1 + y, blank ? 150 + 80 : 150 + Int(Double(cols) * Self.pxMs))
        }
        page.jobs.append(RT.after(at + 4000) { [self] in if pages[peerId] === page { pages[peerId] = nil } })
    }

    /// {c: 列数, d: base64} → 14行ぶんの白黒 (1行は ceil(c/8) バイト、上位ビットが左)。
    static func payloadToGrid(_ p: [String: Any]) -> [[Bool]]? {
        guard let c = (p["c"] as? NSNumber)?.intValue, let d = p["d"] as? String,
              let data = Data(base64Encoded: d) else { return nil }
        let cols = max(1, min(FaxPaper.cols, c))
        let bpr = (cols + 7) / 8
        guard data.count >= bpr * textRows else { return nil }
        let bytes = [UInt8](data)
        return (0..<textRows).map { y in
            (0..<cols).map { x in (bytes[y * bpr + x / 8] >> UInt8(7 - (x % 8))) & 1 == 1 }
        }
    }
}
