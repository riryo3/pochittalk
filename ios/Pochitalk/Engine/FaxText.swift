import CoreGraphics
import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// FAX の送信用: 文字を、14 行の白黒の絵にする (Web 版 textToFaxGrid の移植) と、データ便の中身にする (faxGridToPayload)。
enum FaxText {
    /// 大きく描いてから縮める (小さい字を直接潰すと、線が欠けるため)。インクのある範囲だけを、14 行に写す。
    static func grid(_ text: String) -> [[Bool]] {
        let rows = FaxReceiver.textRows, maxCols = FaxPaper.cols
        #if canImport(UIKit)
        let font = UIFont.monospacedSystemFont(ofSize: 56, weight: .bold)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.black]
        #else
        let font = NSFont.monospacedSystemFont(ofSize: 56, weight: .bold)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black]
        #endif
        let ns = text as NSString
        let w = max(1, Int(ceil(ns.size(withAttributes: attrs).width))) + 4
        let h = 84 // 上下に余裕を持たせ、g のような下へ伸びる字も切らない
        var src = [UInt8](repeating: 0, count: w * h)
        src.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue) else { return }
            ctx.translateBy(x: 0, y: CGFloat(h)); ctx.scaleBy(x: 1, y: -1) // 上から下へ (UIKit の向き)
            #if canImport(UIKit)
            UIGraphicsPushContext(ctx)
            ns.draw(at: CGPoint(x: 2, y: 8), withAttributes: attrs)
            UIGraphicsPopContext()
            #else
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
            ns.draw(at: CGPoint(x: 2, y: 8), withAttributes: attrs)
            NSGraphicsContext.restoreGraphicsState()
            #endif
        }
        var minX = w, maxX = -1, minY = h, maxY = -1
        for y in 0..<h { for x in 0..<w where src[y * w + x] > 40 {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        } }
        if maxX < 0 { return Array(repeating: [false], count: rows) }
        let iw = maxX - minX + 1, ih = maxY - minY + 1
        let cols = max(1, min(maxCols, Int((Double(iw * rows) / Double(ih)).rounded())))
        return (0..<rows).map { y in
            let sy0 = minY + y * ih / rows
            let sy1 = min(maxY + 1, max(sy0 + 1, minY + (y + 1) * ih / rows))
            return (0..<cols).map { x in
                let sx0 = minX + x * iw / cols
                let sx1 = min(maxX + 1, max(sx0 + 1, minX + (x + 1) * iw / cols))
                var ink = 0, tot = 0
                for sy in sy0..<sy1 { for sx in sx0..<sx1 { if src[sy * w + sx] > 100 { ink += 1 }; tot += 1 } }
                return tot > 0 && Double(ink) / Double(tot) > 0.2 // 細い線も残す
            }
        }
    }

    /// {c: 列数, d: base64} (1 行は ceil(c/8) バイト、上位ビットが左)。受信側 (FaxReceiver.payloadToGrid) の逆。
    static func payload(_ grid: [[Bool]]) -> [String: Any] {
        let cols = grid.first?.count ?? 0
        var bytes: [UInt8] = []
        for row in grid {
            for b in 0..<((cols + 7) / 8) {
                var v: UInt8 = 0
                for bit in 0..<8 {
                    let x = b * 8 + bit
                    if x < cols && x < row.count && row[x] { v |= UInt8(1 << (7 - bit)) }
                }
                bytes.append(v)
            }
        }
        return ["c": cols, "d": Data(bytes).base64EncodedString()]
    }
}
