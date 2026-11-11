import SwiftUI

enum DialSide { case left, right }

#if os(macOS)
import AppKit

/// Mac のウィンドウまわり: 最前面への固定 / ダイヤルの横付けドロワーのための広げ縮め / 画面の隅や他のウィンドウへの吸着。
enum MacWindow {
    static let mainWidth: CGFloat = 448
    /// ダイヤルのドロワーが開いているか (キー操作の振り分けに使う)
    static var dialOpen = false
    static var window: NSWindow? {
        // 本体のウィンドウ (ログのウィンドウは除く)
        NSApp.windows.first(where: { $0.isVisible && $0.canBecomeMain && !($0 is NSPanel) && !$0.title.contains("ログ") }) ?? NSApp.windows.first(where: { !$0.title.contains("ログ") })
    }

    // ---- 閉じる・しまう・拡大のボタンは、いつも本体のカード側 (左にドロワーが付いたら、その分だけ右へ)
    static var trafficOffset: CGFloat = 0
    private static var trafficBase: [NSWindow.ButtonType: CGFloat] = [:]
    static func layoutTrafficLights() {
        guard let w = window else { return }
        for t in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let b = w.standardWindowButton(t) else { continue }
            if trafficBase[t] == nil { trafficBase[t] = b.frame.origin.x - trafficOffset }
            b.setFrameOrigin(NSPoint(x: (trafficBase[t] ?? b.frame.origin.x) + trafficOffset, y: b.frame.origin.y))
        }
    }

    // ---- 最前面
    static var pinned: Bool { UserDefaults.standard.bool(forKey: "pochitalk_pin") }
    static func setPinned(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "pochitalk_pin")
        apply()
    }
    static func apply() {
        guard let w = window else { return }
        w.level = pinned ? .floating : .normal
        w.collectionBehavior = pinned ? [.canJoinAllSpaces, .fullScreenAuxiliary] : []
    }

    // ---- ダイヤルのドロワー (ウィンドウの横に広げる)
    /// 左に余裕があれば左 (ウィンドウを左へ広げる)、なければ右。
    static func pickSide(extra: CGFloat) -> DialSide {
        guard let w = window, let s = w.screen ?? NSScreen.main else { return .left }
        let left = w.frame.minX - s.visibleFrame.minX
        let right = s.visibleFrame.maxX - w.frame.maxX
        if left >= extra { return .left }
        return right > left ? .right : .left
    }

    /// 本体の高さに、ウィンドウの高さ (と最小の高さ) を合わせる
    static var lastFitHeight: CGFloat = 0
    static func refit() { if lastFitHeight > 0 { fit(contentHeight: lastFitHeight) } }
    static func fit(contentHeight h: CGFloat) {
        guard let w = window, h > 100 else { return }
        lastFitHeight = h
        // タイトルバーの高さ (フレームの高さ - SwiftUI の表示領域の高さ) を足して、ウィンドウ全体の高さを決める
        let bar = w.frame.height - w.contentLayoutRect.height
        let newH = h + bar
        w.minSize = NSSize(width: mainWidth, height: newH)
        if abs(w.frame.height - newH) > 0.5 {
            var f = w.frame
            // 高さが変わるとき、吸着している側の端を動かさない (下の端が吸着していれば下を固定、そうでなければ上を固定)
            if !snapper.isSnappedBottom(f) || snapper.isSnappedTop(f) { f.origin.y += f.height - newH }
            f.size.height = newH
            snapper.suppress = true
            w.setFrame(f, display: true, animate: false)
            DispatchQueue.main.async { snapper.suppress = false }
        }
    }

    static func resize(open: Bool, side: DialSide, extra: CGFloat) {
        guard let w = window else { return }
        var f = w.frame
        let newW: CGFloat = open ? mainWidth + extra : mainWidth // いつも同じ幅にそろえる (本体 448 + ドロワー)
        if side == .left { f.origin.x = f.maxX - newW } // 左へ広げる/縮めるときは、右端を動かさない
        f.size.width = newW
        if open, let s = w.screen?.visibleFrame { // 画面の外に出ないように
            if f.minX < s.minX { f.origin.x = s.minX }
            if f.maxX > s.maxX { f.origin.x = max(s.minX, s.maxX - f.width) }
        }
        trafficOffset = (open && side == .left) ? extra : 0
        snapper.suppress = true
        w.setFrame(f, display: true, animate: false) // アニメーションなし (途中で中身が伸びたりずれたりしないように)
        layoutTrafficLights()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { snapper.suppress = false }
    }

    // ---- 吸着
    static let snapper = Snapper()
    static func install() {
        NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { n in
            guard let w = n.object as? NSWindow, !(w is NSPanel), w.canBecomeMain else { return }
            snapper.attach(w) // 本体もログのウィンドウも、吸着する
            if w.title.contains("ログ") { return }
            apply()
            layoutTrafficLights()
            NotificationCenter.default.addObserver(forName: NSWindow.didResizeNotification, object: w, queue: .main) { _ in layoutTrafficLights() }
        }
    }

    final class Snapper {
        var suppress = false
        private var busy = false
        private var attachedIds = Set<ObjectIdentifier>()
        private let threshold: CGFloat = 14

        func attach(_ w: NSWindow) {
            guard attachedIds.insert(ObjectIdentifier(w)).inserted else { return }
            NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: w, queue: .main) { [weak self, weak w] _ in
                if let w { self?.snap(w) }
            }
        }

        /// 他のアプリのウィンドウの外枠 (Cocoa の座標。画面収録の許可は要らない)。
        private func otherFrames(excluding number: Int) -> [NSRect] {
            guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
                  let primary = NSScreen.screens.first else { return [] }
            let ph = primary.frame.height
            return list.compactMap { d in
                // 自分のアプリのウィンドウも、吸着の相手にする (動かしているウィンドウ自身は除く)
                guard (d[kCGWindowLayer as String] as? Int) == 0, (d[kCGWindowNumber as String] as? Int) != number,
                      let b = d[kCGWindowBounds as String] as? [String: CGFloat],
                      let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"], w > 80, h > 80 else { return nil }
                return NSRect(x: x, y: ph - y - h, width: w, height: h)
            }
        }

        private func edges(excluding number: Int) -> (tops: [CGFloat], bottoms: [CGFloat]) {
            var tops: [CGFloat] = [], bottoms: [CGFloat] = []
            for s in NSScreen.screens.map({ $0.visibleFrame }) { tops.append(s.maxY); bottoms.append(s.minY) }
            for o in otherFrames(excluding: number) { tops.append(o.minY); bottoms.append(o.maxY) } // 他のウィンドウの下側 / 上側に接している
            return (tops, bottoms)
        }
        func isSnappedBottom(_ f: NSRect) -> Bool { edges(excluding: MacWindow.window?.windowNumber ?? 0).bottoms.contains { abs($0 - f.minY) < 3 } }
        func isSnappedTop(_ f: NSRect) -> Bool { edges(excluding: MacWindow.window?.windowNumber ?? 0).tops.contains { abs($0 - f.maxY) < 3 } }

        private func snap(_ w: NSWindow) {
            guard !busy, !suppress, NSEvent.pressedMouseButtons & 1 != 0 else { return }
            var f = w.frame
            let others = otherFrames(excluding: w.windowNumber)
            let screens = NSScreen.screens.map { $0.visibleFrame }
            var bestDx: CGFloat?, bestDy: CGFloat?
            func consider(_ delta: CGFloat, _ best: inout CGFloat?) {
                if abs(delta) <= threshold, abs(delta) < abs(best ?? .infinity) { best = delta }
            }
            for s in screens {
                consider(s.minX - f.minX, &bestDx); consider(s.maxX - f.maxX, &bestDx)
                consider(s.minY - f.minY, &bestDy); consider(s.maxY - f.maxY, &bestDy)
            }
            for o in others {
                let nearY = f.maxY > o.minY - 40 && f.minY < o.maxY + 40
                let nearX = f.maxX > o.minX - 40 && f.minX < o.maxX + 40
                if nearY {
                    consider(o.maxX - f.minX, &bestDx); consider(o.minX - f.maxX, &bestDx) // となりに並べる
                    consider(o.minX - f.minX, &bestDx); consider(o.maxX - f.maxX, &bestDx)
                }
                if nearX {
                    consider(o.maxY - f.minY, &bestDy); consider(o.minY - f.maxY, &bestDy)
                    consider(o.minY - f.minY, &bestDy); consider(o.maxY - f.maxY, &bestDy)
                }
            }
            guard bestDx != nil || bestDy != nil else { return }
            f.origin.x += bestDx ?? 0; f.origin.y += bestDy ?? 0
            busy = true
            w.setFrameOrigin(f.origin)
            busy = false
        }
    }
}

/// ダイヤルを開く / 閉じる縦書きのタブ。本体のカードの端に、開いているときも同じ場所に出る (同じ場所を押して閉じられる)。
/// 三角は、開くときは、ドロワーが開く向き / 閉じるときは、その逆。
struct MacDialTab: View {
    let side: DialSide
    let open: Bool
    let action: () -> Void
    var body: some View {
        let text: String = open
            ? (side == .left ? "閉じる▶" : "◀閉じる")
            : (side == .left ? "部屋を探す◀" : "▶部屋を探す")
        Button(action: action) {
            VStack(spacing: 2) {
                ForEach(Array(text.enumerated()), id: \.offset) { _, c in
                    Text(String(c)).font(.system(size: 13, weight: .bold)).foregroundStyle(Color(hex: 0xCBD5E1))
                }
            }
            .padding(.horizontal, 7)
            .frame(height: 360) // 縦に長いタブ。開いていても、閉じていても、同じ大きさ
            .background(Color(hex: 0x1F2937), in: shape)
            .overlay(shape.stroke(Color(hex: 0x374151), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 4, x: side == .left ? 2 : -2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? "ダイヤルを閉じる" : "部屋を探す（ダイヤルを開く）")
    }
    private var shape: UnevenRoundedRectangle {
        side == .left ? UnevenRoundedRectangle(bottomTrailingRadius: 14, topTrailingRadius: 14)
                      : UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14)
    }
}
#endif
