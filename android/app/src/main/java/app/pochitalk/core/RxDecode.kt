package app.pochitalk.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos

/**
 * Web版の「モールス受信」と「FAX受信」の復号 (worker.js の decodeMorseRx / decodeFaxRx) の移植。
 * 相手の声 (音声トラック) を 20 ミリ秒の窓で見て、決まった高さの音 (モールスは 700Hz、FAX は 900/1300/1500/2100Hz)
 * が鳴っているかを調べる。窓の長さは 1/50 秒なので、50Hz の倍数の音は漏れずに測れる。
 */
object Morse {
    val CODE: Map<Char, String> = mapOf(
        'A' to ".-", 'B' to "-...", 'C' to "-.-.", 'D' to "-..", 'E' to ".", 'F' to "..-.", 'G' to "--.", 'H' to "....", 'I' to "..", 'J' to ".---",
        'K' to "-.-", 'L' to ".-..", 'M' to "--", 'N' to "-.", 'O' to "---", 'P' to ".--.", 'Q' to "--.-", 'R' to ".-.", 'S' to "...", 'T' to "-",
        'U' to "..-", 'V' to "...-", 'W' to ".--", 'X' to "-..-", 'Y' to "-.--", 'Z' to "--..",
        '1' to ".----", '2' to "..---", '3' to "...--", '4' to "....-", '5' to ".....", '6' to "-....", '7' to "--...", '8' to "---..", '9' to "----.", '0' to "-----",
        '.' to ".-.-.-", ',' to "--..--", '?' to "..--..", '!' to "-.-.--", '/' to "-..-.", '-' to "-....-", ':' to "---...", '\'' to ".----.",
        '"' to ".-..-.", '(' to "-.--.", ')' to "-.--.-", '=' to "-...-", '+' to ".-.-.", '@' to ".--.-.",
    )
    val REVERSE: Map<String, Char> = CODE.entries.associate { it.value to it.key }
    const val UNIT_MS = 100.0
}

/** 1つの窓 (20ms) の測定結果。電力は「平均二乗」(振幅 A の純音なら A²/2) で表す。 */
class ToneFrame(
    /** この窓の終わりの時刻 (ミリ秒。音のサンプル数から数えた時計)。 */
    val atMs: Double,
    val total: Double,
    val p650: Double,
    val p700: Double,
    val p750: Double,
    val pFaxSync: Double,   // 900Hz
    val pFaxWhite: Double,  // 1300Hz
    val pFaxPre: Double,    // 1500Hz
    val pFaxBlack: Double,  // 2100Hz
)

/** 音のサンプルを受け取り、10ms ごとに [ToneFrame] を出す。 */
class ToneAnalyzer(private val sampleRate: Int, private val onFrame: (ToneFrame) -> Unit) {
    private val window = sampleRate / 50
    private val hop = sampleRate / 100
    private val ring = FloatArray(window)
    private var pos = 0
    private var filled = 0
    private var sinceFrame = 0
    private var count = 0L
    private val tmp = FloatArray(window)

    private val freqs = doubleArrayOf(650.0, 700.0, 750.0, 900.0, 1300.0, 1500.0, 2100.0)
    private val coeffs = DoubleArray(freqs.size) { 2.0 * cos(2.0 * PI * freqs[it] / sampleRate) }
    private val power = DoubleArray(freqs.size)

    fun feed(samples: FloatArray, n: Int) {
        for (i in 0 until n) {
            ring[pos] = samples[i]
            pos = (pos + 1) % window
            count++
            if (filled < window) filled++
            if (++sinceFrame >= hop && filled >= window) {
                sinceFrame = 0
                emit()
            }
        }
    }

    private fun emit() {
        var sumSq = 0.0
        for (i in 0 until window) {
            val v = ring[(pos + i) % window]
            tmp[i] = v
            sumSq += v * v
        }
        for (f in freqs.indices) {
            val c = coeffs[f]
            var s1 = 0.0
            var s2 = 0.0
            for (i in 0 until window) {
                val s = tmp[i] + c * s1 - s2
                s2 = s1
                s1 = s
            }
            val mag2 = s1 * s1 + s2 * s2 - c * s1 * s2
            power[f] = 2.0 * mag2 / (window.toDouble() * window) // 純音 (振幅 A) なら A²/2
        }
        onFrame(
            ToneFrame(
                atMs = count * 1000.0 / sampleRate,
                total = sumSq / window,
                p650 = power[0], p700 = power[1], p750 = power[2],
                pFaxSync = power[3], pFaxWhite = power[4], pFaxPre = power[5], pFaxBlack = power[6],
            ),
        )
    }
}

/** モールスの復号 (1人分)。[onFrame] に窓の測定結果を順に渡す。表示用の文字列は [display]。 */
class MorseDecoder(private val onChange: (String) -> Unit, private val onEsc: () -> Unit) {
    private var tone = false
    private var toneAt = 0.0
    private var offAt = 0.0
    private var pat = ""
    private var text = ""
    private var letterDone = false
    private var wordDone = false
    private var hasPend = false
    private var pendDur = 0.0
    private var pendEnd = 0.0
    private var lastDisplay = ""

    fun reset() {
        pat = ""; text = ""; tone = false; hasPend = false; pendDur = 0.0; letterDone = false; wordDone = false
        publish()
    }

    fun display(): String {
        var s = text
        var cur = pat
        if (hasPend) cur += if (pendDur < Morse.UNIT_MS * 2) "." else "-"
        if (cur.isNotEmpty()) s += (if (s.isNotEmpty()) " " else "") + cur.map { if (it == '.') '・' else '−' }.joinToString("")
        return if (s.length > 38) s.takeLast(38) else s
    }

    private fun publish() {
        val d = display()
        if (d != lastDisplay) {
            lastDisplay = d
            onChange(d)
        }
    }

    private fun isTone(f: ToneFrame): Boolean {
        val band = f.p650 + f.p700 + f.p750
        if (f.total <= 0.0) return false
        val pure = band / f.total >= 0.55
        // 開始は少し大きく、続いている間は小さくても保つ (Web版の floor 100 / 70)
        val floor = if (tone) 2.5e-6 else 6e-6
        return pure && f.p700 >= floor
    }

    private fun dist1(a: String, b: String): Boolean {
        if (a == b) return false
        val la = a.length
        val lb = b.length
        if (abs(la - lb) > 1) return false
        if (la == lb) return a.indices.count { a[it] != b[it] } == 1
        val s = if (la < lb) a else b
        val l = if (la < lb) b else a
        var i = 0
        var j = 0
        var skipped = false
        while (i < s.length && j < l.length) {
            if (s[i] == l[j]) { i++; j++ } else {
                if (skipped) return false
                skipped = true
                j++
            }
        }
        return true
    }

    private fun flushChar() {
        if (pat.isEmpty()) return
        val hit = Morse.REVERSE[pat]
        if (hit != null) text += hit else {
            // 完全一致が無くても、1要素違いの候補が1つだけなら推定して読む (目印付き)
            var cand: Char? = null
            var ties = 0
            for ((p, c) in Morse.REVERSE) if (dist1(pat, p)) { cand = c; ties++ }
            text += if (ties == 1 && cand != null) {
                if (cand in 'A'..'Z') cand.lowercaseChar().toString() else "$cand?"
            } else "[" + pat.map { if (it == '.') '・' else '−' }.joinToString("") + "]" // 読めなかった符号は測れた形のまま出す
        }
        text = text.takeLast(60)
        if (text.endsWith("ESC")) onEsc()
        pat = ""
    }

    private fun finalizePend() {
        if (!hasPend) return
        pat += if (pendDur < Morse.UNIT_MS * 2) "." else "-"
        hasPend = false
        pendDur = 0.0
        offAt = pendEnd
    }

    fun onFrame(f: ToneFrame) {
        val now = f.atMs
        val on = isTone(f)
        if (on) {
            if (!tone) {
                tone = true
                toneAt = now
                if (hasPend && now - pendEnd >= 30) finalizePend() // 30ms以上あいたら前の符号は確定
                // 次の符号の始まりで、前の文字との区切りを実測の無音長で確定する
                if (!hasPend && offAt > 0 && (pat.isNotEmpty() || letterDone) && !wordDone) {
                    val gap = now - offAt
                    if (gap >= Morse.UNIT_MS * 5) {
                        if (pat.isNotEmpty()) flushChar()
                        text = (text + " ").takeLast(60)
                    } else if (pat.isNotEmpty() && gap >= Morse.UNIT_MS * 2 + 5) flushChar()
                }
                letterDone = false
                wordDone = false
            }
        } else {
            if (tone) {
                tone = false
                val seg = now - toneAt
                if (seg >= 35) { // 35ms未満のクリック等のノイズは捨てる
                    if (hasPend) pendDur += (toneAt - pendEnd) + seg else { pendDur = seg; hasPend = true }
                    pendEnd = now
                }
            }
            if (hasPend && now - pendEnd >= 30) finalizePend()
            if (!hasPend && (pat.isNotEmpty() || (letterDone && !wordDone))) {
                val silence = now - offAt
                if (silence >= Morse.UNIT_MS * 5 && !wordDone) {
                    if (pat.isNotEmpty()) flushChar()
                    text = (text + " ").takeLast(60)
                    wordDone = true
                    letterDone = true
                } else if (pat.isNotEmpty() && silence >= Morse.UNIT_MS * 2 + 5 && !letterDone) {
                    flushChar()
                    letterDone = true
                }
            }
        }
        publish()
    }
}

/** FAX の開始の合図 (1500Hz の「ピー」) を見つける。8窓つづけて見えたら true を返す。 */
class FaxPreDetector {
    private var count = 0

    /** 窓を1つ渡す。合図が見つかった窓で true (そのあと [reset] するまで再び true は返さない)。 */
    fun onFrame(f: ToneFrame): Boolean {
        val total = f.pFaxSync + f.pFaxWhite + f.pFaxPre + f.pFaxBlack
        val isPre = total > 1e-6 && f.pFaxPre / total >= 0.5 && f.pFaxPre >= 2e-6 &&
            f.pFaxPre / (f.total + 1e-12) >= 0.4
        if (!isPre) { count = 0; return false }
        count++
        return count == PRE_FRAMES
    }

    fun reset() { count = 0 }

    companion object {
        /** 10ms ごとの窓なので、約 120ms ぶん (Web版は 15ms × 8) */
        const val PRE_FRAMES = 12
    }
}

/** FAX の紙 (Web版と同じ寸法) とデータ便の読み書き。 */
object Fax {
    const val ROWS = 15
    const val TEXT_ROWS = 14
    const val MAX_COLS = 240
    const val PX_MS = 20

    /** {c: 幅, d: base64} から 14 行ぶんの絵を作る。壊れていたら null。行は 0/1 の列。 */
    fun payloadToGrid(c: Int, d: String): Array<BooleanArray>? {
        val cols = c.coerceIn(1, MAX_COLS)
        val bin = try {
            java.util.Base64.getMimeDecoder().decode(d)
        } catch (e: IllegalArgumentException) {
            return null
        }
        val bpr = (cols + 7) / 8
        if (bin.size < bpr * TEXT_ROWS) return null
        return Array(TEXT_ROWS) { y ->
            BooleanArray(cols) { x -> ((bin[y * bpr + x / 8].toInt() and 0xff) shr (7 - x % 8)) and 1 == 1 }
        }
    }

    /** 14 行の絵を、`faxPage` のデータ便 {c, d} にする (payloadToGrid の逆。1 行は ceil(c/8) バイト、左端が最上位ビット)。 */
    fun gridToPayload(grid: Array<BooleanArray>): Pair<Int, String> {
        val cols = grid[0].size
        val bpr = (cols + 7) / 8
        val bin = ByteArray(bpr * TEXT_ROWS)
        for (y in 0 until TEXT_ROWS) for (x in 0 until cols) {
            if (grid[y][x]) bin[y * bpr + x / 8] = (bin[y * bpr + x / 8].toInt() or (0x80 shr (x % 8))).toByte()
        }
        return cols to java.util.Base64.getEncoder().encodeToString(bin)
    }

    /**
     * 紙に何ミリ秒で何行目が出るか (送信側と同じ進行表)。空行は短く、本文行は同期150ms+幅ぶん。
     * 戻り値は (行の番号 0..14, 出る時刻 ms) の並び。0 行目は余白。
     */
    fun revealSchedule(grid: Array<BooleanArray>): List<Pair<Int, Long>> {
        val cols = grid[0].size
        val out = ArrayList<Pair<Int, Long>>()
        var at = 0L
        out.add(0 to at)
        at += 150 + 80
        for (y in 0 until TEXT_ROWS) {
            out.add((1 + y) to at)
            val blank = grid[y].none { it }
            at += if (blank) 150 + 80 else 150L + cols * PX_MS
        }
        return out
    }
}
