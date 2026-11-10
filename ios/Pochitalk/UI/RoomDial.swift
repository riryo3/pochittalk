import SwiftUI

private let rowH: CGFloat = 132
private let stepDeg: Double = 36 // 1行あたりの回転角

/// 回転量 `center` (行数。先頭の部屋が真ん中に来ているときが 0) を、アニメーションの途中でもなめらかに補間する描画部分。
/// 部屋は円柱の表面に並び、中央の1行が真正面を向く (Web 版の .rdial / Android 版 RoomDial.kt と同じモデル)。
private struct DialBody: View, Animatable {
    var center: Double
    let rooms: [RoomInfo]
    let connected: Int
    let pendingKey: String?

    var animatableData: Double {
        get { center }
        set { center = newValue }
    }

    private var radius: Double { Double(rowH) / (stepDeg * .pi / 180) }

    var body: some View {
        let nearest = Int(center.rounded()).clamped(0, max(0, rooms.count - 1))
        ZStack {
            // 円柱の側面を横切る細い線 (回すと流れ、上下ほど詰まる)
            Canvas { ctx, size in
                let rot = center * stepDeg
                let cy = size.height / 2
                for k in 0..<36 {
                    let rel = (((Double(k) * 10 - rot).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360)) - 180
                    if abs(rel) > 86 { continue }
                    let rr = rel * .pi / 180
                    let a = (0.12 + 0.88 * (1 - cos(rr))) * 0.16
                    let y = cy + radius * sin(rr)
                    var p = Path(); p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y))
                    ctx.stroke(p, with: .color(Color(hex: 0x94A3B8, alpha: a)), lineWidth: 1)
                }
            }
            ForEach(Array(rooms.enumerated()), id: \.element.key) { i, room in
                let off = Double(i) - center
                let th = max(-88, min(88, off * stepDeg))
                let rad = th * .pi / 180
                let c = cos(rad)
                DialRow(room: room, connected: connected, pending: room.key == pendingKey, onLine: i == nearest)
                    .frame(height: rowH)
                    .scaleEffect(y: CGFloat(max(0.04, c)))
                    .offset(y: CGFloat(radius * sin(rad)))
                    .opacity(abs(off) > 2.6 ? 0 : max(0.12, pow(c, 1.1)))
            }
        }
    }
}

private struct DialRow: View {
    let room: RoomInfo
    let connected: Int
    let pending: Bool
    let onLine: Bool

    var body: some View {
        let full = room.count >= PochiEngine.maxRoom && !room.isCurrent
        let edge: Color = room.air ? PC.tx : pending ? PC.amber : isBotRoom(room.key) ? PC.botGreen : .clear
        let bg: Color = room.isCurrent ? Color(hex: 0x172554, alpha: 0.55) : onLine ? Color(hex: 0x3B82F6, alpha: 0.10) : .clear
        let head = (isBotRoom(room.key) ? "🦜 " : "") + (room.air ? "🔴 " : "🔵 ") + formatKey(room.key) + " · 👤\(room.count)"
            + (room.isCurrent && room.count != connected ? "（つながっているのは \(connected) 人）" : "")
            + (room.count >= PochiEngine.maxRoom ? " · 満員" : "") + (pending ? " · 招待" : "")
        let who = room.invited ? "招待された部屋（現在は無人）" : (room.count == 0 && room.names.isEmpty ? "この部屋には、いま誰もいません" : room.names.joined(separator: "、"))
        HStack(spacing: 0) {
            edge.frame(width: 3)
            VStack(alignment: .leading, spacing: 0) {
                Text(head).font(.system(size: 14, design: .monospaced)).foregroundStyle(PC.text).lineLimit(1)
                Spacer().frame(height: 8)
                if !room.tag.isEmpty {
                    Text("🏷 " + room.tag + (room.tagBy.isEmpty ? "" : "（\(room.tagBy)）")).font(.system(size: 12)).foregroundStyle(Color(hex: 0x93C5FD)).lineLimit(1)
                }
                Text(who).font(.system(size: 12)).foregroundStyle(PC.muted).fixedSize(horizontal: false, vertical: true) // 全員の名前を省略せず、折り返して出す
                Spacer(minLength: 0)
            }
            .padding(.leading, 13).padding(.trailing, 16).padding(.top, 9)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .background(bg)
        .grayscale(full ? 0.7 : 0) // 満員の部屋は、白黒に近く
    }
}

/// 部屋を探すダイヤル。上下に回し、赤い線に合わせた部屋をタップすると入る。ほかの部屋をタップすると、そこまで回る。
/// 何も指定がなければ、おうむ返しの部屋が赤い線に来る。入室すると、その部屋が赤い線まで回る。
struct RoomDial: View {
    let rooms: [RoomInfo]
    let connected: Int
    let pendingKey: String?
    let emptyText: String
    let onJoin: (String) -> Void
    /// 赤い線に合っている部屋が変わったとき (なければ nil)。
    var onFocus: ((String?) -> Void)?
    /// 横に長く動かされたとき (縦のダイヤル操作ではなかったとき) の、横の移動量。ドロワーを閉じるスワイプに使う。
    var onSideSwipe: ((CGFloat) -> Void)?

    @State private var center: Double = 0
    @State private var dragBase: Double?
    @GestureState private var dragging = false
    @State private var userMoved = false
    @State private var anchor: String?
    @State private var lastCurrent: String?

    private var keys: [String] { rooms.map(\.key) }
    private var focusIndex: Int { rooms.isEmpty ? -1 : Int(center.rounded()).clamped(0, rooms.count - 1) }
    private func reportFocus() { onFocus?(focusIndex >= 0 ? rooms[focusIndex].key : nil) }

    var body: some View {
        ZStack {
            redLine // 文字の後ろ (Web 版と同じ)
            if rooms.isEmpty {
                Text(emptyText).font(.system(size: 13)).foregroundStyle(PC.muted).padding(.horizontal, 16).multilineTextAlignment(.center)
            } else {
                DialBody(center: center, rooms: rooms, connected: connected, pendingKey: pendingKey)
                    .allowsHitTesting(false) // 行の当たり判定は、見た目と合わない。タップは、下の handleTap で位置から決める
            }
            rails
            // 上下の暗がり
            VStack(spacing: 0) {
                LinearGradient(colors: [Color(hex: 0x0F1419), .clear], startPoint: .top, endPoint: .bottom).frame(height: rowH * 3 * 0.22)
                Spacer()
                LinearGradient(colors: [.clear, Color(hex: 0x0F1419)], startPoint: .top, endPoint: .bottom).frame(height: rowH * 3 * 0.22)
            }.allowsHitTesting(false)
        }
        .frame(height: rowH * 3)
        .frame(maxWidth: .infinity)
        .background(DialScrollGuard())
        .contentShape(Rectangle())
        .gesture(SpatialTapGesture().onEnded { handleTap($0.location.y) })
        .background(Color(hex: 0x0F1419))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0x2D3748), lineWidth: 1))
        // 画面全体のスクロールより優先する (ダイヤルの上の縦の動きは、ダイヤルを回す)
        .highPriorityGesture(
            DragGesture(minimumDistance: 4) // すぐに反応させる (画面のスクロールに負けないように)。小さい動きは、終わったときにタップとして扱う
                .updating($dragging) { _, state, _ in state = true }
                .onChanged { v in
                    if dragBase == nil { dragBase = center }
                    if abs(v.translation.width) > 16 && abs(v.translation.width) > abs(v.translation.height) * 2 { return } // 横のスワイプ: ダイヤルは回さない
                    if abs(v.translation.height) >= 10 { userMoved = true }
                    let n = Double(max(0, rooms.count - 1))
                    center = min(n + 0.3, max(-0.3, (dragBase ?? 0) - Double(v.translation.height / rowH)))
                }
                .onEnded { v in
                    let base = dragBase ?? center
                    dragBase = nil
                    if abs(v.translation.width) > 16 && abs(v.translation.width) > abs(v.translation.height) * 2 {
                        center = base; snap(to: Int(base.rounded()), user: false)
                        onSideSwipe?(v.translation.width)
                        return
                    }
                    // 指のぶれ程度 (合計10pt未満) は、タップとして扱う: 元の位置へ戻して、押した場所の行を選ぶ
                    if abs(v.translation.height) < 10 && abs(v.translation.width) < 10 {
                        center = base
                        handleTap(v.startLocation.y)
                        return
                    }
                    let moved = true
                    let momentum = Double(v.predictedEndTranslation.height - v.translation.height) / Double(rowH) * 0.4
                    let travelled = Double(v.translation.height / rowH)
                    let projected = base - travelled - max(-3, min(3, momentum))
                    snap(to: Int(projected.rounded()), user: moved)
                }
        )
        .onChange(of: dragging) { now in
            // ドラッグが途中で中断された (スクロールに取られた等) ときも、いちばん近い部屋に止める
            if !now, dragBase != nil {
                dragBase = nil
                snap(to: Int(center.rounded()), user: true)
            }
        }
        .onAppear { settle(animated: false); reportFocus() }
        .onChange(of: focusIndex) { _ in reportFocus() }
        .onChange(of: rooms) { _ in settle(animated: false); reportFocus() } // 一覧の中身 (いまいる部屋の印など) が変わったとき
        .onChange(of: rooms.first(where: \.isCurrent)?.key) { cur in
            // 入室した (いる部屋が変わった) 瞬間に、その部屋が赤い線まで回る
            guard let cur, cur != lastCurrent else { lastCurrent = cur; return }
            lastCurrent = cur
            userMoved = false
            if let i = keys.firstIndex(of: cur) { snap(to: i, user: false) }
        }
    }

    /// タップした位置 (ダイヤルの上端からの y) にある行を、見た目の円柱の配置から求める。
    /// 赤い線に合っている行ならば入室、ほかの行ならば、そこまで回す。
    private func handleTap(_ y: CGFloat) {
        guard !rooms.isEmpty else { return }
        let radius = Double(rowH) / (stepDeg * .pi / 180)
        var best: Int?
        var bestOff = Double.infinity
        for i in rooms.indices {
            let off = Double(i) - center
            if abs(off) > 2.6 { continue }
            let rad = max(-88, min(88, off * stepDeg)) * .pi / 180
            let mid = Double(rowH) * 3 / 2 + radius * sin(rad)
            let half = Double(rowH) / 2 * max(0.04, cos(rad))
            if abs(Double(y) - mid) <= half, abs(off) < bestOff { best = i; bestOff = abs(off) }
        }
        guard let i = best else { return }
        let nearest = Int(center.rounded()).clamped(0, rooms.count - 1)
        if i == nearest { onJoin(rooms[i].key) } else { snap(to: i, user: true) }
    }

    private func snap(to index: Int, user: Bool) {
        guard !rooms.isEmpty else { return }
        let i = index.clamped(0, rooms.count - 1)
        withAnimation(.interpolatingSpring(stiffness: 170, damping: 22)) { center = Double(i) }
        anchor = rooms[i].key
    }

    /// 一覧が変わったとき。指で回すまでは、いちばん良い初期位置 (いまいる部屋 > 招待 > おうむ返し > 先頭) に合わせ続ける。
    /// 回したあとは、同じ部屋を赤い線に残す。
    private func settle(animated: Bool) {
        guard !rooms.isEmpty, dragBase == nil else { return }
        let preferred = rooms.firstIndex(where: \.isCurrent)
            ?? rooms.firstIndex(where: { $0.key == pendingKey })
            ?? max(0, rooms.firstIndex(where: { $0.key == botRoomKey }) ?? 0)
        let target = userMoved ? (anchor.flatMap { keys.firstIndex(of: $0) } ?? preferred) : preferred
        if animated { snap(to: target, user: false) } else { center = Double(target); anchor = rooms[target].key }
    }

    /// 赤い線 (1行目と2行目のすきまを通る)
    private var redLine: some View {
        Canvas { ctx, size in
            let y = size.height / 2
            let x0: CGFloat = 6, x1 = size.width - 6
            var line = Path(); line.move(to: CGPoint(x: x0, y: y)); line.addLine(to: CGPoint(x: x1, y: y))
            ctx.stroke(line, with: .color(PC.tx.opacity(0.22)), lineWidth: 8)
            ctx.stroke(line, with: .color(PC.tx), lineWidth: 2)
            let t: CGFloat = 5
            var l = Path(); l.move(to: CGPoint(x: x0 - 2, y: y - t)); l.addLine(to: CGPoint(x: x0 - 2 + t * 2, y: y)); l.addLine(to: CGPoint(x: x0 - 2, y: y + t)); l.closeSubpath()
            var r = Path(); r.move(to: CGPoint(x: x1 + 2, y: y - t)); r.addLine(to: CGPoint(x: x1 + 2 - t * 2, y: y)); r.addLine(to: CGPoint(x: x1 + 2, y: y + t)); r.closeSubpath()
            ctx.fill(l, with: .color(PC.tx)); ctx.fill(r, with: .color(PC.tx))
        }.allowsHitTesting(false)
    }

    /// 両端の目盛りの溝
    private var rails: some View {
        Canvas { ctx, size in
            let rot = center * stepDeg
            let cy = size.height / 2
            let radius = Double(rowH) / (stepDeg * .pi / 180)
            let railW: CGFloat = 13
            ctx.fill(Path(CGRect(x: 0, y: 0, width: railW, height: size.height)), with: .linearGradient(Gradient(colors: [Color.white.opacity(0.07), .clear]), startPoint: .zero, endPoint: CGPoint(x: railW, y: 0)))
            ctx.fill(Path(CGRect(x: size.width - railW, y: 0, width: railW, height: size.height)), with: .linearGradient(Gradient(colors: [.clear, Color.white.opacity(0.07)]), startPoint: CGPoint(x: size.width - railW, y: 0), endPoint: CGPoint(x: size.width, y: 0)))
            for k in 0..<30 {
                let rel = (((Double(k) * 12 - rot).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360)) - 180
                if abs(rel) > 86 { continue }
                let rr = rel * .pi / 180
                let a = (0.2 + 0.8 * cos(rr)) * 0.6
                let y = cy + radius * sin(rr)
                let col = Color(hex: 0xCBD5E1, alpha: a)
                var p = Path(); p.move(to: CGPoint(x: 2, y: y)); p.addLine(to: CGPoint(x: railW - 2, y: y))
                var q = Path(); q.move(to: CGPoint(x: size.width - railW + 2, y: y)); q.addLine(to: CGPoint(x: size.width - 2, y: y))
                ctx.stroke(p, with: .color(col), lineWidth: 2); ctx.stroke(q, with: .color(col), lineWidth: 2)
            }
        }.allowsHitTesting(false)
    }
}

extension Int {
    func clamped(_ lo: Int, _ hi: Int) -> Int { Swift.min(Swift.max(self, lo), hi) }
}

/// ダイヤルに指が触れたら、そのあいだ、画面全体 (親の UIScrollView) のスクロールを止める。
/// 画面がまだ慣性でスクロールしている最中に、ダイヤルを触っても、ダイヤルが負けないようにするため。
/// (SwiftUI のジェスチャーだけでは、スクロールの慣性中のタッチは、スクロール側が先に取ってしまう)
struct DialScrollGuard: UIViewRepresentable {
    func makeUIView(context: Context) -> GuardView { GuardView() }
    func updateUIView(_ uiView: GuardView, context: Context) {}

    final class GuardView: UIView, UIGestureRecognizerDelegate {
        private weak var scrollView: UIScrollView?
        private var recognizer: TouchRecognizer?

        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let r = recognizer { r.view?.removeGestureRecognizer(r); r.release(); recognizer = nil }
            guard window != nil else { return }
            var v: UIView? = superview
            while let x = v, !(x is UIScrollView) { v = x.superview }
            guard let sv = v as? UIScrollView else { return }
            scrollView = sv
            let r = TouchRecognizer(guardView: self, scrollView: sv)
            r.delegate = self
            sv.addGestureRecognizer(r)
            recognizer = r
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }

    final class TouchRecognizer: UIGestureRecognizer {
        private weak var guardView: GuardView?
        private weak var scrollView: UIScrollView?
        private var holding = false
        private var safety: DispatchWorkItem?

        init(guardView: GuardView, scrollView: UIScrollView) {
            self.guardView = guardView
            self.scrollView = scrollView
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
        }

        func release() { restore() }

        private func restore() {
            safety?.cancel()
            if holding { scrollView?.panGestureRecognizer.isEnabled = true }
            holding = false
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            guard let t = touches.first, let g = guardView, let sv = scrollView else { state = .failed; return }
            if g.bounds.contains(t.location(in: g)) {
                // 慣性スクロールをその場で止めて、このタッチのあいだは、スクロールさせない
                sv.setContentOffset(sv.contentOffset, animated: false)
                sv.panGestureRecognizer.isEnabled = false
                holding = true
                safety?.cancel()
                let item = DispatchWorkItem { [weak self] in self?.restore() } // 念のため、10秒で必ず戻す
                safety = item
                DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: item)
            }
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { restore(); state = .failed }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { restore(); state = .failed }
        override func reset() { restore() }
    }
}
