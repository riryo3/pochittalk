import XCTest
@testable import Pochitalk

final class RxDecodeTests: XCTestCase {
    /// 送信側 (Web 版) と同じ間隔で 700Hz のモールスを作り、ToneMeter → MorseDecoder で文字に戻せるか。
    private func decode(_ word: String, rate: Double = 48000) -> String {
        var samples: [Int16] = []
        func silence(_ ms: Double) { samples += [Int16](repeating: 0, count: Int(rate * ms / 1000)) }
        func tone(_ ms: Double) {
            let n = Int(rate * ms / 1000)
            for i in 0..<n { samples.append(Int16(0.35 * 32767 * sin(2 * Double.pi * 700 * Double(i) / rate))) }
        }
        silence(700)
        for (ci, ch) in word.enumerated() {
            if ch == " " { silence(600); continue }
            let pat = Array(morseCode[ch]!)
            for (i, c) in pat.enumerated() {
                tone(c == "." ? 100 : 300)
                if i < pat.count - 1 { silence(100) }
            }
            silence(100)
            if ci < word.count - 1 { silence(200) }
        }
        silence(800)
        let meter = ToneMeter()
        samples.withUnsafeBufferPointer { p in
            var i = 0
            while i < p.count { let n = min(480, p.count - i); meter.feed(p.baseAddress! + i, n, rate: rate); i += n }
        }
        let d = MorseDecoder()
        var last = ""
        d.onRender = { last = $0 }
        for b in meter.drain() { d.process(b) }
        d.flush()
        return last.trimmingCharacters(in: .whitespaces)
    }

    func testMorseSOS() { XCTAssertEqual(decode("SOS"), "SOS") }
    func testMorseWords() { XCTAssertEqual(decode("CQ 73"), "CQ 73") }
    func testMorseSilenceReadsNothing() { XCTAssertEqual(decode(""), "") }

    func testFaxPayload() {
        // 1行 = 4バイト (c=30)、14行。先頭ビット (左端) だけ黒の行を作る
        var bytes = [UInt8](repeating: 0, count: 4 * 14)
        bytes[0] = 0x80
        bytes[4 * 13 + 3] = 0x04 // 最後の行の、30列目 (ビット2)
        let json: [String: Any] = ["c": 30, "d": Data(bytes).base64EncodedString()]
        let g = FaxReceiver.payloadToGrid(json)
        XCTAssertNotNil(g)
        XCTAssertEqual(g?.count, 14)
        XCTAssertEqual(g?[0].count, 30)
        XCTAssertEqual(g?[0][0], true)
        XCTAssertEqual(g?[0][1], false)
        XCTAssertEqual(g?[13][29], true)
        XCTAssertNil(FaxReceiver.payloadToGrid(["c": 30, "d": "AAAA"])) // 短すぎる
    }

    /// 送信側の絵づくり: 14 行・幅 240 以内で、字のインクがあり、データ便の形式で往復できる。
    func testFaxTextGridRoundTrip() {
        let grid = FaxText.grid("FAX 12")
        XCTAssertEqual(grid.count, FaxReceiver.textRows)
        let cols = grid[0].count
        XCTAssertTrue(cols > 20 && cols <= FaxPaper.cols, "cols=\(cols)")
        XCTAssertTrue(grid.joined().contains(true))
        // 上下が逆さまでないこと: 先頭の「F」は、一番上の行に横棒 (左端 10 列のインクが多い)、一番下の行は縦棒だけ (少ない)
        let top = grid[0].prefix(10).filter { $0 }.count, bottom = grid[13].prefix(10).filter { $0 }.count
        XCTAssertTrue(top >= 6 && bottom <= 4, "top=\(top) bottom=\(bottom)")
        let back = FaxReceiver.payloadToGrid(FaxText.payload(grid))
        XCTAssertEqual(back, grid)
        for r in grid { print(String(r.map { $0 ? "#" : "." })) }
    }
}
