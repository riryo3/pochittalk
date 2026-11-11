import SwiftUI

/// 左端の帯 (タブ) から開く、ダイヤルのドロワー (Web 版のスマホ表示と同じ)。
/// 中身: 見出しと人数 / 絞り込み / ダイヤル / 赤い線の部屋の詳しい情報と「この部屋に入る」。
struct DialDrawer: View {
    /// 表示の層: tab = 閉じているときの左端のタブ (キーボードより下)、panel = 開いたドロワー (すべての最前面)。
    enum Layer { case tab, panel }
    var layer: Layer
    let ui: UiState
    @Binding var open: Bool
    @Binding var focusKey: String?
    /// 入室の依頼 (確認は、呼ぶ側が出す)
    var onJoin: (String) -> Void = { _ in }

    private func setOpen(_ o: Bool) { withAnimation(.easeOut(duration: 0.25)) { open = o } }

    var body: some View {
        GeometryReader { geo in
            let w = min(geo.size.width * 0.88, 400)
            let tabH = min(430, geo.size.height * 0.78) // Web 版と同じ: 縦に長いタブ
            let top = geo.safeAreaInsets.top, bottom = geo.safeAreaInsets.bottom
            ZStack(alignment: .leading) {
                if layer == .panel && open {
                    // 暗い背景: タップで閉じる。左へのスワイプでも閉じる (右側からのスワイプ)
                    Color.black.opacity(0.5).ignoresSafeArea()
                        .onTapGesture { setOpen(false) }
                        .gesture(closeSwipe)
                }
                // 閉じているときの、左端のタブ。タップでも、左端から右へのスワイプでも開く
                if layer == .tab && !open {
                    tabBody("部屋を探す▶", height: tabH).frame(width: 38, alignment: .leading)
                        .frame(maxHeight: .infinity)
                        .accessibilityLabel("部屋を探す（ダイヤルを開く）")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { setOpen(true) }
                    Color.clear.frame(width: 38).contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onEnded { v in
                            if v.translation.width > 24 || (abs(v.translation.width) < 10 && abs(v.translation.height) < 10) { setOpen(true) }
                        })
                }
                if layer == .panel { HStack(spacing: 0) {
                    ScrollView { content.padding(14).padding(.top, top).padding(.bottom, bottom + 14) }
                        .frame(width: w)
                        .background(PC.card)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: 20, topTrailingRadius: 20))
                        .overlay(UnevenRoundedRectangle(bottomTrailingRadius: 20, topTrailingRadius: 20).stroke(PC.border, lineWidth: 1))
                        .shadow(color: .black.opacity(0.5), radius: 12)
                        .simultaneousGesture(closeSwipe)
                    Button { setOpen(false) } label: { tabBody("◀閉じる", height: tabH) }
                        .buttonStyle(.plain).accessibilityLabel("ダイヤルを閉じる")
                        .frame(maxHeight: .infinity)
                    Spacer(minLength: 0)
                }
                .ignoresSafeArea() // 画面の上から下まで、いっぱいに
                .offset(x: open ? 0 : -(w + 60))
                .allowsHitTesting(open)
                }
            }
        }
        .allowsHitTesting(layer == .tab ? !open : open)
    }

    /// 左向きのスワイプ (横に長く動かしたとき) で閉じる。
    private var closeSwipe: some Gesture {
        DragGesture(minimumDistance: 24).onEnded { v in
            if v.translation.width < -60 && abs(v.translation.width) > abs(v.translation.height) * 1.5 { setOpen(false) }
        }
    }

    /// 縦書きの丸いタブ (文字は縦に積む)
    private func tabBody(_ text: String, height: CGFloat? = nil) -> some View {
        VStack(spacing: 2) {
            ForEach(Array(text.enumerated()), id: \.offset) { _, c in
                Text(String(c)).font(.system(size: 13, weight: .bold)).foregroundStyle(Color(hex: 0xCBD5E1))
            }
        }
        .padding(.horizontal, 7).padding(.vertical, 18)
        .frame(height: height)
        .background(Color(hex: 0x1F2937), in: UnevenRoundedRectangle(bottomTrailingRadius: 14, topTrailingRadius: 14))
        .overlay(UnevenRoundedRectangle(bottomTrailingRadius: 14, topTrailingRadius: 14).stroke(Color(hex: 0x374151), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 4, x: 2)
    }

    private var content: some View {
        #if os(macOS)
        DialPanel(ui: ui, focusKey: $focusKey, onJoin: { join($0) }, onSideSwipe: { if $0 < -60 { setOpen(false) } }, showDetail: false) // Mac: 部屋の詳細は出さない
        #else
        DialPanel(ui: ui, focusKey: $focusKey, onJoin: { join($0) }, onSideSwipe: { if $0 < -60 { setOpen(false) } })
        #endif
    }

    private func join(_ key: String) { onJoin(key) }
}

/// ダイヤルの中身 (見出しと人数 / 絞り込み / ダイヤル / 赤い線の部屋の詳しい情報と「この部屋に入る」)。
/// スマホではドロワーの中に、iPad など広い画面では、右の列のカードの中に置く。
struct DialPanel: View {
    let ui: UiState
    @Binding var focusKey: String?
    var onJoin: (String) -> Void = { _ in }
    var onSideSwipe: ((CGFloat) -> Void)?
    /// ダイヤルの下の、赤い線の部屋の説明と「この部屋に入る」。広い画面 (iPad) では出さない (Web 版と同じ)。
    var showDetail = true
    @State private var search = ""

    private var filtered: [RoomInfo] {
        var q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return ui.rooms }
        if let r = q.range(of: "r=", options: .backwards) { q = String(q[r.upperBound...]) } // 招待 URL を貼ったときは、部屋の符号で探す
        q = q.replacingOccurrences(of: "·", with: "")
        return ui.rooms.filter { r in
            r.key.contains(q) || r.tag.lowercased().contains(q) || r.names.contains { $0.lowercased().contains(q) }
        }
    }

    /// 絞り込み欄に入れた文字が部屋の符号 (8 文字) の形で、その部屋が一覧にないとき、その符号 (部屋を作って入れる)。
    private var typedNewKey: String? {
        var q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if let r = q.range(of: "r=", options: .backwards) { q = String(q[r.upperBound...]) }
        q = q.filter { $0.isLetter || $0.isNumber }
        guard isRoomKey(q), !ui.rooms.contains(where: { $0.key == q }) else { return nil }
        return q
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("いまある部屋（赤い線でタップ）").font(.system(size: 12)).foregroundStyle(PC.muted)
                Spacer()
                Text("👤 \(ui.totalPeople)人 / \(ui.rooms.count)部屋").font(.system(size: 12, design: .monospaced)).foregroundStyle(PC.sky)
            }
            TextField("🔍 URL・ハッシュ・名前・話題で絞り込み", text: $search).pochiField().font(.system(size: 14))
                .noAutoCap()
            if let k = typedNewKey {
                Button { join(k) } label: { Text("「\(formatKey(k))」の部屋を作って入る").frame(maxWidth: .infinity) }
                    .buttonStyle(SubButtonStyle())
            }
            RoomDial(
                rooms: filtered,
                connected: ui.peers.count + 1, pendingKey: ui.pendingKey,
                emptyText: !ui.ready ? "接続の準備中です…" : search.isEmpty ? "いま誰もいません。「NEW 新しい部屋」で始められます" : "見つかりませんでした",
                onJoin: { join($0) }, onFocus: { focusKey = $0 }, onSideSwipe: onSideSwipe)
            if showDetail { detail }
            if !ui.ready || true {
                Button(ui.reconnecting ? "再接続中…" : "一覧を再接続") { PochiEngine.shared.reconnect() }
                    .buttonStyle(SubButtonStyle(small: true)).disabled(ui.reconnecting)
            }
        }
    }

    private func join(_ key: String) { onJoin(key) }

    @ViewBuilder private var detail: some View {
        let room = filtered.first { $0.key == focusKey }
        VStack(alignment: .leading, spacing: 8) {
            Divider().overlay(Color(hex: 0x374151))
            if let room {
                Text(formatKey(room.key)).font(.system(size: 18, weight: .heavy, design: .monospaced)).foregroundStyle(Color(hex: 0x93C5FD))
                if !room.tag.isEmpty {
                    Text("🏷 " + room.tag + (room.tagBy.isEmpty ? "" : "（\(room.tagBy)）")).font(.system(size: 14)).foregroundStyle(Color(hex: 0x93C5FD))
                }
                Text(room.invited ? "招待された部屋（いまは無人）" : room.count == 0 ? "いまは誰もいません" : "👤 \(room.count)人" + (room.count >= PochiEngine.maxRoom ? "（満員）" : ""))
                    .font(.system(size: 13)).foregroundStyle(PC.muted)
                if !room.names.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(room.names, id: \.self) { n in
                            Text(n).font(.system(size: 13)).foregroundStyle(PC.text).padding(.horizontal, 10).padding(.vertical, 3)
                                .background(Color(hex: 0x1F2937), in: Capsule()).overlay(Capsule().stroke(Color(hex: 0x374151), lineWidth: 1))
                        }
                    }
                }
                Button { join(room.key) } label: { Text(room.isCurrent ? "いま入っている部屋です" : "この部屋に入る").frame(maxWidth: .infinity) }
                    .buttonStyle(SubButtonStyle())
                    .disabled(room.isCurrent || (room.count >= PochiEngine.maxRoom && !room.isCurrent))
            } else {
                Text("ダイヤルを回して、部屋を選んでください").font(.system(size: 13)).foregroundStyle(PC.muted)
            }
        }
    }
}
