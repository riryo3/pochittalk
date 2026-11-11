import SwiftUI

/// 無線機画面: Web 版と同じく、1つの「無線機」カードの中に、ヘッダー / 液晶 (ROOM HASH・レベル・話題タグ・状態・参加者) /
/// 話すボタン / 招待・再接続・VOX・効果音 を並べる。部屋一覧は、無線機の下に並べる。
struct RadioScreen: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    @State private var showQr = false
    @State private var drawerOpen = false
    @State private var focusKey: String?
    @State private var showSettings = false
    @State private var showAbout = false
    @State private var showWelcome = false
    @State private var confirm: ConfirmRequest?
    /// 初回案内は、アプリを起動したときに1回だけ出す
    private static var welcomeShown = false
    @State private var nickDraft = ""
    @FocusState private var nickFocused: Bool

    /// この幅より広い画面 (iPad など) では、Web 版の広い画面と同じ 2 列にする: 左 = 本体、右 = ダイヤルと操作ボタン。
    private static let wideWidth: CGFloat = 800
    #if os(macOS)
    private static let isMac = true
    #else
    private static let isMac = false
    #endif

    var body: some View {
        GeometryReader { geo in
            let wide = !Self.isMac && geo.size.width >= Self.wideWidth // Mac は、ダイヤルを左のドロワーに隠した 1 列にする
            ZStack(alignment: .leading) {
                if wide { wideLayout(height: geo.size.height) }
                else if Self.isMac { macLayout }
                else { narrowLayout }
                if ui.currentKey != nil && !Self.isMac { // Mac は物理キーボードがあるので、画面のキーボードは出さない
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        MorseKeyboard(ui: ui)
                            .background(GeometryReader { g in Color.clear.preference(key: CardHeightKey.self, value: g.size.height) })
                    }
                    .onPreferenceChange(CardHeightKey.self) { kbHeight = $0 }
                }
                if !wide && !Self.isMac {
                    DialDrawer(layer: .panel, ui: ui, open: $drawerOpen, focusKey: $focusKey, onJoin: { requestJoin($0) }) // 開いたドロワーは、最前面
                }
            }
            .onChange(of: wide) { w in if w { drawerOpen = false } }
        }
        .onChange(of: ui.currentKey) { _ in showQr = false; closeDrawer() }
        #if os(iOS)
        .background(HardwareKeys { key, down in hwKey(key, down) }) // 外付け・Bluetooth キーボード
        #endif
        .onAppear {
            if nickDraft.isEmpty { nickDraft = ui.nickname }
            if !Self.welcomeShown { Self.welcomeShown = true; showWelcome = WelcomeView.needed() } // 保存値を直接読む (起動直後は、画面の状態がまだ既定値のため)
        }
        .onChange(of: ui.nickname) { n in if nickDraft.isEmpty { nickDraft = n } }
        .onReceive(NotificationCenter.default.publisher(for: .pochiMenu)) { n in // Mac のメニューバーから
            switch n.object as? String {
            case "settings": showSettings = true
            case "dial": setDial(!drawerOpen)
            case "new": requestNew()
            case "leave": if ui.currentKey != nil { confirm = ConfirmRequest(title: "この部屋から退出しますか？", message: "", okLabel: "退出") { engine.leave() } }
            case "reconnect": if ui.currentKey != nil { engine.reconnect() }
            default: break
            }
        }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { c in
            Button(c.okLabel) { c.action() }
            Button("キャンセル", role: .cancel) {}
        } message: { c in Text(c.message) }
        .sheet(isPresented: $showAbout) { AboutView() }
        .sheet(isPresented: $showSettings) { SettingsView(ui: ui, engine: engine) }
        .sheet(isPresented: $showWelcome) { WelcomeView(ui: ui, engine: engine, onSettings: { showWelcome = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { showSettings = true } }) }
    }

    private var versionText: some View {
        Text("版 \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
            .font(.system(size: 11)).foregroundStyle(PC.muted.opacity(0.7))
    }

    /// スマホ: 1 枚のカード + 左端のタブから開くダイヤルのドロワー。
    private var narrowLayout: some View {
        ZStack(alignment: .leading) {
            ScrollView {
                VStack(spacing: 12) {
                    deviceCard(wide: false)
                    versionText
                }
                .frame(maxWidth: Self.isMac ? 448 : .infinity)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 2) // 左端は、ドロワーのタブが、カードに重なる
            }
            .scrollDismissesKeyboardCompat()
            .scrollBounceIfNeeded() // 収まる画面 (12 Pro など) では、スクロールもバウンドもしない。小さい端末だけスクロール
            .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: ui.currentKey != nil ? kbHeight : 0) }
            // 画面のどこからでも、左から右へのスワイプで、ダイヤルのドロワーが開く (話している間は開かない)
            .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { v in
                if v.translation.width > 70 && v.translation.width > abs(v.translation.height) * 1.5 && !ui.ledTx {
                    withAnimation(.easeOut(duration: 0.25)) { drawerOpen = true }
                }
            })
            DialDrawer(layer: .tab, ui: ui, open: $drawerOpen, focusKey: $focusKey) // タブは、キーボードより下
        }
    }

    #if os(iOS)
    @State private var hwSpaceDown = false

    /// 外付けキーボード (Mac 版のキー操作と同じ考え)。処理したら true。
    /// ・ダイヤルが開いているとき: ↑↓ で回す / Enter で入室 / Esc で閉じる
    /// ・入室中: スペースを押している間だけ話す / 文字キー = モールス / 「fax」で FAX モード (Enter 送信・Backspace 消す・Tab 送り方・Esc 解除) / Esc = モールスで ESC
    private func hwKey(_ key: UIKey, _ down: Bool) -> Bool {
        if !key.modifierFlags.intersection([.command, .control, .alternate]).isEmpty { return false } // ⌘ などは、システムに任せる
        if showSettings || showAbout || showWelcome || confirm != nil { return false }
        let code = key.keyCode
        if showQr { // QR の裏が出ているとき: Esc で表に戻すだけ
            if down && code == .keyboardEscape { toggleQr(); return true }
            return false
        }
        if drawerOpen {
            guard down else { return false }
            switch code {
            case .keyboardUpArrow: NotificationCenter.default.post(name: .pochiDial, object: "up"); return true
            case .keyboardDownArrow: NotificationCenter.default.post(name: .pochiDial, object: "down"); return true
            case .keyboardReturnOrEnter, .keypadEnter: NotificationCenter.default.post(name: .pochiDial, object: "enter"); return true
            case .keyboardEscape: withAnimation(.easeOut(duration: 0.25)) { drawerOpen = false }; return true
            default: return false
            }
        }
        guard ui.currentKey != nil else { return false }
        let fax = ui.faxCompose != nil
        if code == .keyboardSpacebar || key.characters == " " {
            if fax { if down { engine.morseKey(" ") }; return true } // FAX モードでは、スペースは空白
            if down { if !hwSpaceDown { hwSpaceDown = true; engine.pttPress() } }
            else if hwSpaceDown { hwSpaceDown = false; engine.pttRelease() }
            return true
        }
        guard down else { return false }
        let morse: String
        switch code {
        case .keyboardDeleteOrBackspace: morse = "BS"
        case .keyboardReturnOrEnter, .keypadEnter: morse = "ENTER"
        case .keyboardEscape: morse = "ESC"
        case .keyboardTab: if !fax { return false }; morse = "TAB"
        default:
            if fax { // FAX モード: 大文字・小文字・記号を、打ったとおりに
                guard var c = key.characters.first, let a = c.asciiValue, a >= 0x21, a <= 0x7E else { return false }
                if c.isLetter, let base = key.charactersIgnoringModifiers.first { // 大文字・小文字は、Shift の有無で決める
                    c = key.modifierFlags.contains(.shift) ? Character(base.uppercased()) : Character(base.lowercased())
                }
                morse = String(c)
            } else {
                guard let c = key.characters.uppercased().first, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?!/-:".contains(c) else { return false }
                morse = String(c)
            }
        }
        engine.morseKey(morse)
        return true
    }
    #endif

    // ================================================================ Mac: ダイヤルを、ウィンドウの横に付けるドロワーにする

    @State private var dialSide: DialSide = .left
    @State private var pinned = false
    private static let dialWidth: CGFloat = 380

    private func closeDrawer() {
        #if os(macOS)
        if drawerOpen { setDial(false) }
        #else
        drawerOpen = false
        #endif
    }

    private func setDial(_ open: Bool) {
        #if os(macOS)
        guard open != drawerOpen else { return }
        if open { dialSide = MacWindow.pickSide(extra: Self.dialWidth) }
        MacWindow.resize(open: open, side: dialSide, extra: Self.dialWidth)
        drawerOpen = open
        MacWindow.dialOpen = open
        #endif
    }

    #if os(macOS)
    /// Mac: 左 (なければ右) にダイヤルのカードが付く。ウィンドウごと、その分だけ広がる。本体のカードは動かない。
    private var macLayout: some View {
        HStack(alignment: .top, spacing: 0) {
            if !drawerOpen { Spacer(minLength: 0) }
            if drawerOpen && dialSide == .left { macDialCard }
            ZStack(alignment: dialSide == .left ? .leading : .trailing) {
                ScrollView {
                    VStack(spacing: 12) {
                        deviceCard(wide: false)
                        versionText
                    }
                    .background(GeometryReader { g in Color.clear.preference(key: MacContentHeightKey.self, value: g.size.height) })
                    .padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 8)
                }
                .scrollBounceIfNeeded()
                MacDialTab(side: dialSide, open: drawerOpen) { setDial(!drawerOpen) } // 開いていても、同じ場所に出す
                    .frame(maxHeight: .infinity)
            }
            .frame(width: 448) // 開く途中でも、本体は伸び縮みしない
            if drawerOpen && dialSide == .right { macDialCard }
            if !drawerOpen { Spacer(minLength: 0) }
        }
        .onPreferenceChange(MacContentHeightKey.self) { h in MacWindow.fit(contentHeight: h + 14) }
        .onAppear { pinned = MacWindow.pinned; refreshDialSide() }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didMoveNotification)) { _ in refreshDialSide() }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didChangeScreenNotification)) { _ in refreshDialSide() }
    }

    /// 閉じているあいだ、左に余裕がなければ、すぐ右側にタブを移す (ウィンドウを動かすたびに見直す)
    private func refreshDialSide() {
        guard !drawerOpen else { return }
        let s = MacWindow.pickSide(extra: Self.dialWidth)
        if s != dialSide { dialSide = s }
    }

    private var macDialCard: some View {
        VStack(spacing: 8) {
            DialPanel(ui: ui, focusKey: $focusKey, onJoin: { requestJoin($0) }, showDetail: false)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(width: Self.dialWidth)
        .frame(maxHeight: .infinity)
        .background(PC.card)
    }
    #else
    private var macLayout: some View { EmptyView() }
    #endif

    /// iPad など広い画面 (Web 版の広い画面と同じ): 2 列のカードを、画面の中央に置く。
    /// 左 = 本体のカード / 右 = ダイヤルのカード、その下に、操作ボタン (入室中) またはハンドルネームと設定 (入室前) のカード。
    private func wideLayout(height: CGFloat) -> some View {
        ScrollView {
            HStack(alignment: .top, spacing: 24) {
                VStack(spacing: 12) {
                    deviceCard(wide: true)
                    versionText
                }
                .frame(maxWidth: 400)
                VStack(spacing: 16) {
                    PochiCard { DialPanel(ui: ui, focusKey: $focusKey, onJoin: { requestJoin($0) }, showDetail: false) }
                    PochiCard { if let key = ui.currentKey { controlButtons(key) } else { nameAndSettings } }
                }
                .frame(maxWidth: 400)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .frame(minHeight: height - (ui.currentKey != nil ? kbHeight : 0) - 32, alignment: .center) // 縦も、中央に
            .padding(.vertical, 16)
        }
        .scrollBounceIfNeeded()
        .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: ui.currentKey != nil ? kbHeight : 0) }
    }

    @State private var frontHeight: CGFloat = 0

    /// QR の裏返し: 約 0.2 秒で 90° 回って入れ替わり、0.22 秒で戻る (合わせて約 0.42 秒)。「動きを減らす」のときは、アニメーションなし。
    private func toggleQr() {
        if reduceMotionOn { showQr.toggle() }
        else { withAnimation(.easeInOut(duration: 0.42)) { showQr.toggle() } }
    }
    @State private var kbHeight: CGFloat = 0

    private func deviceCard(wide: Bool) -> some View {
        let key = ui.currentKey
        return FlipCard(angle: showQr && key != nil ? 180 : 0, front: cardFront(key, wide: wide), back: cardBack(key, wide: wide))
    }

    private func cardChrome<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        c()
            .padding(22)
            .frame(maxWidth: .infinity)
            .background(PC.card, in: RoundedRectangle(cornerRadius: 28))
            .overlay(RoundedRectangle(cornerRadius: 28).stroke(PC.border, lineWidth: 2))
            .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
    }

    private func header(_ key: String?, wide: Bool) -> some View {
        VStack(spacing: 10) {
            HStack {
                Brand()
                Spacer()
                if !wide { reconnectLeaveButtons(key) } // 広い画面では、右の列の操作ボタンのカードに移す
            }
            Rectangle().fill(PC.border).frame(height: 2)
        }
    }

    /// 再接続・退出。`fill` のとき (広い画面の操作ボタンのカード) は、2 つで幅を等分する (Web 版の #ctrlCard の flex: 1)。
    private func reconnectLeaveButtons(_ key: String?, fill: Bool = false) -> some View {
        HStack(spacing: fill ? 8 : 6) {
            Button { engine.reconnect() } label: { Text(ui.reconnecting ? "再接続中…" : "再接続").frame(maxWidth: fill ? .infinity : nil) }
                .buttonStyle(SubButtonStyle(small: !fill)).disabled(ui.reconnecting)
            Button { confirm = ConfirmRequest(title: "この部屋から退出しますか？", message: "", okLabel: "退出") { engine.leave() } } label: { Text("退出").frame(maxWidth: fill ? .infinity : nil) }
                .buttonStyle(SubButtonStyle(small: !fill)).disabled(key == nil)
            #if os(macOS)
            if !fill {
                Button { pinned.toggle(); MacWindow.setPinned(pinned) } label: { Text("📌").opacity(pinned ? 1 : 0.45) }
                    .buttonStyle(SubButtonStyle(container: pinned ? Color(hex: 0x1E3A8A) : PC.chip, small: true))
                    .help(pinned ? "最前面に表示中（クリックで解除）" : "最前面に表示する")
            }
            #endif
        }
    }

    /// 広い画面の操作ボタンのカード: 1 段目 = 再接続・退出 / 2 段目 = 招待URL・QR・ミュート (Web 版の #ctrlCard)。
    private func controlButtons(_ key: String) -> some View {
        VStack(spacing: 10) {
            reconnectLeaveButtons(key, fill: true)
            footer(key)
        }
    }

    private func cardFront(_ key: String?, wide: Bool) -> some View {
        cardChrome {
            VStack(spacing: 12) {
                header(key, wide: wide)
                DisplayPanel(ui: ui, key: key, shown: shownRoom, meter: engine.meter)
                PttSection(ui: ui, idle: idleButton)
                if key == nil { idleExtras(wide: wide) }
                if let key, !wide { footer(key) }
            }
        }
        .background(GeometryReader { g in Color.clear.preference(key: CardHeightKey.self, value: g.size.height) })
        .onPreferenceChange(CardHeightKey.self) { frontHeight = $0 }
    }

    /// 裏: 招待の QR。表と同じ大きさのカードで、同じボタンの列を持つ (QR ボタンで表に戻る)。
    private func cardBack(_ key: String?, wide: Bool) -> some View {
        cardChrome {
            VStack(spacing: 16) {
                if let key { QrBackFace(roomKey: key) }
                Spacer(minLength: 0)
                if let key, !wide { footer(key) }
            }
            .frame(maxHeight: .infinity, alignment: .top) // 表と同じ高さいっぱいに
        }
    }

    /// 入室前に、液晶に出す部屋 (招待された部屋、なければダイヤルの赤い線の部屋)。
    private var shownRoom: RoomInfo? {
        guard ui.currentKey == nil, let k = ui.pendingKey ?? focusKey else { return nil }
        return ui.rooms.first { $0.key == k }
    }

    /// 入室前の大きなボタン: 招待リンクで開いた → JOIN / どこにも入っていない → NEW。
    private var idleButton: IdleButton? {
        guard ui.currentKey == nil else { return nil }
        if let k = ui.pendingKey { return IdleButton(title: "JOIN", sub: "入室") { engine.join(k) } }
        return IdleButton(title: "NEW", sub: "新しい部屋") { requestNew() }
    }

    /// 入室前 (本体のカードの中): 招待のリンク。スマホでは、ハンドルネームと設定も、ここに置く。
    private func idleExtras(wide: Bool) -> some View {
        VStack(spacing: 12) {
            if ui.pendingKey != nil {
                HStack(spacing: 14) {
                    linkButton("あとで") { engine.setPendingKey(nil) }
                    linkButton("新しい部屋を作る") { requestNew(clearPending: true) }
                    linkButton("使い方・プライバシー") { showAbout = true }
                }
            }
            if !wide { nameAndSettings } // 広い画面では、右の列のカードに移す
        }
    }

    /// ハンドルネームと設定ボタン (広い画面では、右の列のカード)。
    private var nameAndSettings: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("ハンドルネーム（みんなに見える、あなたの名前）").font(.system(size: 12)).foregroundStyle(PC.muted)
                TextField("ハンドルネーム", text: $nickDraft)
                    .focused($nickFocused).pochiField().submitLabel(.done)
                    .onChange(of: nickDraft) { v in
                        let t = String(v.prefix(12))
                        if t != v { nickDraft = t }
                        engine.setNickname(t)
                    }
                    .onChange(of: nickFocused) { f in if !f { engine.commitNickname() } }
                    .onSubmit { nickFocused = false }
            }
            Button { showSettings = true } label: { Text("⚙ 設定（マイク・このアプリについて）").frame(maxWidth: .infinity) }
                .buttonStyle(SubButtonStyle(container: Color(hex: 0x4B5563)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0x9CA3AF), lineWidth: 1))
            if ui.micPermission == .denied {
                Text("マイクが許可されていません。設定アプリ → ぽちっと通話 → マイク で許可してください。")
                    .font(.system(size: 12)).foregroundStyle(PC.amber)
            }
        }
    }

    /// 入室の確認 (Web 版 tuneKey)。満員は、確認の前に弾く。いまの部屋にいるときは、退出も伝える。
    private func requestJoin(_ key: String) {
        if key == ui.currentKey { drawerOpen = false; return }
        let room = ui.rooms.first { $0.key == key }
        if let room, room.count >= PochiEngine.maxRoom { engine.join(key); return } // 「この部屋は満員です」を出す
        var msg = formatKey(key) + ((room?.count ?? 0) > 0 ? "（いま \(room!.count) 人）" : "")
        if ui.currentKey != nil { msg += "\nいまの部屋からは退出します。" }
        confirm = ConfirmRequest(title: "この部屋に入室しますか？", message: msg, okLabel: "入室") { closeDrawer(); engine.join(key) }
    }

    private func requestNew(clearPending: Bool = false) {
        confirm = ConfirmRequest(title: "新しい部屋を作って、入室しますか？", message: ui.currentKey != nil ? "いまの部屋からは退出します。" : "", okLabel: "作って入室") {
            if clearPending { engine.setPendingKey(nil) }
            engine.createRoom()
        }
    }

    private func linkButton(_ t: String, _ a: @escaping () -> Void) -> some View {
        Button(t, action: a).font(.system(size: 13)).foregroundStyle(Color(hex: 0x93C5FD)).underline()
    }

    private func footer(_ key: String) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                if let url = engine.inviteUrl(for: key).flatMap(URL.init(string:)) {
                    ShareLink(item: url, message: Text("ぽちっと通話の部屋に入ろう")) {
                        Text("招待URLを送る").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SubButtonStyle())
                }
                Button { toggleQr() } label: { QrIcon().frame(width: 40) }
                    .buttonStyle(SubButtonStyle())
                    .accessibilityLabel("QRコードで招待")
                Button { engine.toggleSpeakerMute() } label: { Text(ui.speakerMuted ? "🔇" : "🔈").font(.system(size: 18)).frame(width: 40) }
                    .buttonStyle(SubButtonStyle(container: ui.speakerMuted ? Color(hex: 0x7F1D1D) : Color(hex: 0x374151)))
                    .accessibilityLabel(ui.speakerMuted ? "スピーカーのミュートを解除" : "スピーカーをミュート")
            }
            VoxSection(ui: ui, engine: engine)
        }
    }
}

/// QR ボタンの絵 (三つの角の四角と、右下の点)。
struct QrIcon: View {
    var body: some View {
        Canvas { ctx, size in
            let u = size.width / 24
            for (x, y) in [(3.0, 3.0), (14.0, 3.0), (3.0, 14.0)] {
                ctx.stroke(Path(roundedRect: CGRect(x: x * u, y: y * u, width: 7 * u, height: 7 * u), cornerRadius: u), with: .color(.white), lineWidth: 2 * u)
            }
            for (x, y, w) in [(14.0, 14.0, 3.0), (19.0, 14.0, 2.0), (14.0, 19.0, 2.0), (18.0, 18.0, 3.0)] {
                ctx.fill(Path(CGRect(x: x * u, y: y * u, width: w * u, height: w * u)), with: .color(.white))
            }
        }.frame(width: 22, height: 22)
    }
}

/// 液晶: ROOM HASH / レベルメーター / 話題タグ / TX・RX・状態 / 参加者 (Web 版の .display)。
private struct DisplayPanel: View {
    let ui: UiState
    let key: String?
    /// 入室前に出す部屋 (招待された部屋 / ダイヤルの赤い線の部屋)
    let shown: RoomInfo?
    let meter: MeterState
    #if os(macOS)
    private let roomHashSize: CGFloat = 26 // Mac は、部屋のアドレスを小さめに (色はそのまま)
    #else
    private let roomHashSize: CGFloat = 38
    #endif

    var body: some View {
        VStack(spacing: 12) {
            VStack(spacing: 2) {
                Text(key != nil ? "ROOM HASH" : ui.pendingKey != nil ? "招待された部屋" : "ダイヤルの部屋").font(.system(size: 12, design: .monospaced)).tracking(3).foregroundStyle(PC.muted)
                Text(key.map(formatKey) ?? shown.map { formatKey($0.key) } ?? "----·----").font(.system(size: roomHashSize, weight: .black, design: .monospaced)).foregroundStyle(PC.sky)
                    .minimumScaleFactor(0.6).lineLimit(1)
                if let k = key ?? shown?.key {
                    let at = ui.rooms.first { $0.key == k }?.openAt ?? 0
                    TimelineView(.periodic(from: .now, by: 15)) { tl in
                        let t = openLabel(k, at, now: Int(tl.date.timeIntervalSince1970 * 1000))
                        Text(t.isEmpty ? " " : t).font(.system(size: 12)).foregroundStyle(PC.muted).frame(maxWidth: .infinity).lineLimit(1)
                    }.frame(height: 16)
                }
                if let c = ui.faxCompose {
                    Text(c.isEmpty ? "FAX[\(ui.faxAnalog ? "完全アナログ" : "アナログライクデジタル")] 文字を打って ⏎ で送信（ESCで終了）" : c + "▌")
                        .font(.system(size: 12, design: c.isEmpty ? .default : .monospaced)).foregroundStyle(c.isEmpty ? PC.muted : PC.sky)
                        .multilineTextAlignment(.center).lineLimit(1).frame(height: 18)
                } else {
                    let queued = ui.flash == nil && ui.rxText.isEmpty && (!ui.morseText.isEmpty || !ui.morseSent.isEmpty)
                    Text(ui.flash ?? (ui.rxText.isEmpty ? (queued ? (ui.morseSent.isEmpty ? "送信待ち " + ui.morseText : "送信中 " + ui.morseSent + (ui.morseText.isEmpty ? "" : "｜" + ui.morseText)) : " ") : ui.rxText)).font(.system(size: 12, design: ui.flash == nil && (!ui.rxText.isEmpty || queued) ? .monospaced : .default))
                    .foregroundStyle(ui.flash == nil && (!ui.rxText.isEmpty || queued) ? PC.sky : PC.muted).multilineTextAlignment(.center)
                    .lineLimit(1).frame(height: 18)
                }
                if let paper = ui.faxPaper { FaxPaperView(paper: paper) }
                LevelMeter(meter: meter)
            }
            if key != nil { TagRow(ui: ui) }
            else if let r = shown, !r.tag.isEmpty {
                Text("🏷 " + r.tag + (r.tagBy.isEmpty ? "" : "（\(r.tagBy)）")).font(.system(size: 13)).foregroundStyle(Color(hex: 0x93C5FD))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                HStack(spacing: 14) {
                    HStack(spacing: 4) { Led(on: ui.ledTx, color: PC.tx); Text("TX").font(.system(size: 11, weight: .heavy)).foregroundStyle(PC.muted) }
                    HStack(spacing: 4) { Led(on: ui.ledRx, color: PC.rx); Text("RX").font(.system(size: 11, weight: .heavy)).foregroundStyle(PC.muted) }
                }
                Spacer()
                Text(key != nil ? ui.statusText : "入室していません").font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundStyle(key != nil ? statusColor : PC.muted)
            }
            Divider().overlay(Color(hex: 0x2D3748))
            if key != nil { peers } else { idlePeers }
            if key != nil { Text("接続 \(ui.connN) / 在室 \(ui.connM)" + (ui.connAudio < ui.connN ? "（音声OK \(ui.connAudio)）" : "")).font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(ui.connN >= ui.connM ? PC.botGreen : Color(hex: 0xFACC15))
                .frame(maxWidth: .infinity, alignment: .trailing) }
        }
        .padding(16)
        .background(PC.panel, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0x22272E), lineWidth: 2))
    }

    /// 入室前: 液晶に出している部屋にいる人の名札と人数。
    private var idlePeers: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let r = shown {
                if r.names.isEmpty {
                    Text(r.invited ? "招待された部屋（現在は無人）" : "（いま誰もいません）").font(.system(size: 13)).foregroundStyle(PC.muted).opacity(0.6)
                } else {
                    FlowLayout(spacing: 4) { ForEach(r.names, id: \.self) { chip($0, fg: PC.muted, bg: PC.chip, bold: false) } }
                }
                Text("👤 \(r.count)人").font(.system(size: 12)).foregroundStyle(PC.muted).frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                Text("左のタブから部屋を探せます").font(.system(size: 13)).foregroundStyle(PC.muted).opacity(0.6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusColor: Color {
        switch ui.status {
        case .tx: return PC.tx
        case .rx: return PC.rx
        case .crosstalk: return Color(hex: 0xF59E0B)
        case .standby: return PC.sky
        }
    }

    private var peers: some View {
        let myName = ui.nickname.trimmingCharacters(in: .whitespaces).isEmpty ? "NoName" : ui.nickname.trimmingCharacters(in: .whitespaces)
        return FlowLayout(spacing: 4) {
            chip((ui.logRec ? "💾" : "") + myName + "（自分）", fg: ui.ledTx ? Color(hex: 0xFECACA) : Color(hex: 0xBFDBFE),
                 bg: ui.ledTx ? Color(hex: 0x7F1D1D) : Color(hex: 0x172554), bold: ui.ledTx)
            ForEach(ui.peers) { p in
                chip(p.name, fg: p.talking ? PC.botGreen : PC.muted, bg: p.talking ? Color(hex: 0x064E3B) : PC.chip, bold: p.talking)
            }
            // 一覧にはいるのに、まだ音声がつながっていない人: 赤いチップ (つながったら消える)
            ForEach(Array(ui.missingNames.enumerated()), id: \.offset) { _, n in
                chip(n, fg: Color(hex: 0xFECACA), bg: Color(hex: 0x450A0A), bold: false)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xEF4444), lineWidth: 1))
                    .contextMenu { Text("一覧にはいますが、まだつながっていません") }
                    .accessibilityHint("一覧にはいますが、まだつながっていません")
            }
            if ui.peers.isEmpty && ui.missingNames.isEmpty {
                Text("（ほかの参加者を待っています）").font(.system(size: 13)).foregroundStyle(PC.muted).opacity(0.6).padding(.vertical, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chip(_ text: String, fg: Color, bg: Color, bold: Bool) -> some View {
        Text(text).font(.system(size: 13, weight: bold ? .bold : .regular)).foregroundStyle(fg)
            .padding(.horizontal, 8).padding(.vertical, 1).background(bg, in: RoundedRectangle(cornerRadius: 6))
    }
}

/// 折り返して並べるレイアウト (参加者の名札用)。
struct FlowLayout: Layout {
    var spacing: CGFloat = 4
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 300
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > w { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); maxX = max(maxX, x)
        }
        return CGSize(width: min(w, maxX), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

/// 音量レベルメーター (Web 版の LEVEL / MIC / TX / RX)。
struct LevelMeter: View {
    let meter: MeterState
    private var idle: Bool { meter.label == "MIC" || meter.label == "LEVEL" }
    var body: some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x0B0E12))
                    RoundedRectangle(cornerRadius: 4)
                        .fill(LinearGradient(colors: [PC.rx, PC.amber, PC.tx], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(meter.level))
                        .opacity(idle ? 0.3 : 1) // 待機中 (MIC / LEVEL) は薄く。TX / RX のときだけ、はっきり
                    Rectangle().fill(Color.white.opacity(0.85)).frame(width: 2)
                        .offset(x: max(0, geo.size.width * CGFloat(meter.peak) - 2))
                        .opacity(meter.peak > 0.01 ? 1 : 0)
                }
            }
            .frame(height: 10)
            HStack {
                Text(meter.label).font(.system(size: 10, design: .monospaced)).foregroundStyle(PC.muted)
                Spacer()
                Text(meter.dbText).font(.system(size: 10, design: .monospaced)).foregroundStyle(PC.muted)
            }
        }
        .padding(.top, 4)
    }
}

/// 話題タグの行: 誰でもつけられ、付けた人の名前が添えられる。部屋の一覧にも出る。
private struct TagRow: View {
    let ui: UiState
    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                label.lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                // おうむ返しボットの部屋は、説明のタグを守るため、編集できない
                if !isBotRoom(ui.currentKey) {
                    Button(ui.roomTag.isEmpty ? "つける" : "変える") {
                        editing.toggle()
                        if editing { draft = ui.roomTag; focused = true }
                    }.buttonStyle(SubButtonStyle(small: true))
                }
            }
            if editing {
                HStack(spacing: 8) {
                    TextField("いまの話題（例：ゲームの話）", text: $draft)
                        .focused($focused).pochiField().submitLabel(.done)
                        .onChange(of: draft) { v in if v.unicodeScalars.count > 30 { draft = String(String.UnicodeScalarView(v.unicodeScalars.prefix(30))) } }
                        .onSubmit(commit)
                    Button("確定", action: commit).buttonStyle(SubButtonStyle())
                }
                Text("\(draft.unicodeScalars.count) / 30 文字").font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(draft.unicodeScalars.count >= 30 ? PC.amber : PC.muted).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private var label: Text {
        if ui.roomTag.isEmpty { return Text("🏷 話題タグ：まだありません").font(.system(size: 13)).foregroundColor(PC.muted) }
        var t = Text("🏷 ").font(.system(size: 13)).foregroundColor(PC.muted) + Text(ui.roomTag).font(.system(size: 13, weight: .bold)).foregroundColor(PC.text)
        if !ui.roomTagBy.isEmpty { t = t + Text("  （\(ui.roomTagBy)が付けた）").font(.system(size: 11)).foregroundColor(PC.muted.opacity(0.8)) }
        return t
    }

    private func commit() {
        PochiEngine.shared.setTag(draft)
        editing = false
        focused = false
    }
}

/// 話すボタン (押している間だけ話す) と、VOX の丸ボタン。
private struct CardHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct ConfirmRequest: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let okLabel: String
    let action: () -> Void
}

struct IdleButton { let title: String; let sub: String; let action: () -> Void }

private struct PttSection: View {
    let ui: UiState
    /// 入室前の大きなボタン (NEW / JOIN)。あれば、話すボタンの代わりに出す
    var idle: IdleButton?
    private let circle: CGFloat = 180
    @State private var gesture: PttGesture?
    @State private var holdTimer: DispatchWorkItem?

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let circleLeft: CGFloat = {
                switch ui.pttPos {
                case .left: return 0
                case .center: return (w - circle) / 2
                case .right: return w - circle
                }
            }()
            let voxOnLeft: Bool = {
                switch ui.pttPos {
                case .left: return false
                case .right: return true
                case .center: return !ui.lefty
                }
            }()
            let voxLeft = voxOnLeft ? max(0, circleLeft - 65) : min(w - 62, circleLeft + circle + 3)
            ZStack(alignment: .topLeading) {
                pttCircle.offset(x: circleLeft)
                VoxButton(on: ui.voxOn).offset(x: voxLeft, y: circle - 62 + 14)
                    .opacity(idle == nil ? 1 : 0.45).allowsHitTesting(idle == nil)
            }
        }
        .frame(height: circle + 14)
    }

    private var pttCircle: some View {
        if let idle { return AnyView(idleCircle(idle)) }
        return AnyView(talkCircle)
    }

    private func idleCircle(_ b: IdleButton) -> some View {
        Button(action: b.action) {
            ZStack {
                Circle().fill(RadialGradient(colors: [Color(hex: 0x3B82F6), Color(hex: 0x1D4ED8)], center: .center, startRadius: 0, endRadius: 100))
                Circle().stroke(Color(hex: 0x1E3A8A), lineWidth: 6)
                VStack(spacing: 2) {
                    Text(b.title).font(.system(size: 24, weight: .black)).foregroundStyle(.white)
                    Text(b.sub).font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.9))
                }
            }
            .frame(width: circle, height: circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(b.title == "JOIN" ? "入室" : "新しい部屋を作る")
    }

    private var talkCircle: some View {
        let tx = ui.ledTx
        return ZStack {
            Circle().fill(RadialGradient(colors: tx ? [Color(hex: 0xEF4444), Color(hex: 0xB91C1C)] : [Color(hex: 0x3B82F6), Color(hex: 0x1D4ED8)],
                                         center: .center, startRadius: 0, endRadius: 100))
            Circle().stroke(tx ? Color(hex: 0x7F1D1D) : Color(hex: 0x1E3A8A), lineWidth: 6)
            VStack(spacing: 2) {
                Text("PUSH").font(.system(size: 21, weight: .black)).foregroundStyle(.white)
                Text("TO TALK").font(.system(size: 12)).tracking(2).foregroundStyle(.white.opacity(0.85))
                #if os(macOS)
                Text("スペースキー").font(.system(size: 10)).foregroundStyle(.white.opacity(0.6))
                #endif
            }
        }
        .frame(width: circle, height: circle)
        .scaleEffect(tx ? 0.96 : 1)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { v in
                    let now = ProcessInfo.processInfo.systemUptime * 1000
                    if gesture == nil {
                        var g = PttGesture(center: CGPoint(x: circle / 2, y: circle / 2), outsideRadius: circle / 2 + 14)
                        g.onDown(now, v.location)
                        gesture = g
                        scheduleHold()
                    } else {
                        var g = gesture!
                        let a = g.onMove(now, v.location)
                        gesture = g
                        apply(a)
                    }
                }
                .onEnded { _ in
                    holdTimer?.cancel()
                    if var g = gesture {
                        let a = g.onUp()
                        apply(a)
                    }
                    gesture = nil
                }
        )
        .accessibilityLabel("話すボタン")
        .accessibilityAddTraits(.isButton)
    }

    private func scheduleHold() {
        holdTimer?.cancel()
        let item = DispatchWorkItem {
            guard var g = gesture else { return }
            let a = g.onTimer(ProcessInfo.processInfo.systemUptime * 1000)
            gesture = g
            apply(a)
        }
        holdTimer = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.055, execute: item)
    }

    private func apply(_ a: PttGesture.Action) {
        switch a {
        case .start: PochiEngine.shared.pttPress()
        case .release: PochiEngine.shared.pttRelease()
        case .abort: PochiEngine.shared.pttAbort()
        case .swipe, .none: break
        }
    }
}

/// VOX の丸ボタン: オフは灰色、オンは緑に光る。
private struct VoxButton: View {
    let on: Bool
    var body: some View {
        Button { PochiEngine.shared.setVox(!on) } label: {
            VStack(spacing: 0) {
                Text("VOX").font(.system(size: 13, weight: .heavy)).tracking(1)
                Text(on ? "ON" : "OFF").font(.system(size: 10, weight: .heavy)).opacity(0.85)
            }
            .foregroundStyle(on ? Color(hex: 0x052E1C) : PC.muted)
            .frame(width: 62, height: 62)
            .background(on ? AnyShapeStyle(RadialGradient(colors: [Color(hex: 0x34D399), Color(hex: 0x059669)], center: .center, startRadius: 0, endRadius: 40)) : AnyShapeStyle(Color(hex: 0x1F2937)), in: Circle())
            .overlay(Circle().stroke(on ? Color(hex: 0x065F46) : Color(hex: 0x374151), lineWidth: 3))
            .shadow(color: on ? Color(hex: 0x10B981).opacity(0.6) : .clear, radius: 10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(on ? "VOXをオフにする" : "VOXをオンにする")
    }
}

private struct VoxSection: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    var body: some View {
        if ui.voxOn {
            VStack(alignment: .leading, spacing: 8) {
                // メーター: 緑 = 入力レベル、黄色の線 = しきい値。しきい値を超えると赤
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 5).fill(PC.panel)
                        Rectangle().fill(ui.voxLevel > ui.voxThreshold ? PC.tx : PC.rx).frame(width: geo.size.width * CGFloat(min(1, max(0, ui.voxLevel))))
                        Rectangle().fill(PC.amber).frame(width: 2).offset(x: geo.size.width * CGFloat(min(1, max(0, ui.voxThreshold))))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(PC.border, lineWidth: 1))
                }.frame(height: 10)
                HStack(spacing: 8) {
                    Text("しきい値").font(.system(size: 13)).foregroundStyle(PC.muted)
                    Slider(value: Binding(get: { Double(ui.voxSens) }, set: { engine.setVoxSensitivity(Int($0.rounded())) }), in: 1...10, step: 1)
                }
                Text("スピーカーの音を拾いやすいので、イヤホンがおすすめです。ロック画面でも、通話中は VOX が使えます。入力レベルは、ホームの「設定」で変えられます。")
                    .font(.system(size: 11)).foregroundStyle(PC.muted)
            }
        }
    }
}


/// 受信した FAX の紙 (240×15 の白黒を拡大して出す。Web 版の faxCanvas)。
private struct FaxPaperView: View {
    let paper: FaxPaper

    var body: some View {
        Canvas { ctx, size in
            let w = size.width / CGFloat(FaxPaper.cols), h = size.height / CGFloat(FaxPaper.rows)
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 248 / 255, green: 248 / 255, blue: 240 / 255)))
            for y in 0..<FaxPaper.rows {
                var x = 0
                while x < FaxPaper.cols {
                    if paper.pixels[y * FaxPaper.cols + x] == 0 { x += 1; continue }
                    var x2 = x
                    while x2 < FaxPaper.cols && paper.pixels[y * FaxPaper.cols + x2] == 1 { x2 += 1 }
                    ctx.fill(Path(CGRect(x: CGFloat(x) * w, y: CGFloat(y) * h, width: CGFloat(x2 - x) * w, height: h)),
                             with: .color(Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)))
                    x = x2
                }
            }
        }
        .aspectRatio(CGFloat(FaxPaper.cols) / CGFloat(FaxPaper.rows), contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(.top, 6)
        .accessibilityLabel("受信したFAX")
    }
}
