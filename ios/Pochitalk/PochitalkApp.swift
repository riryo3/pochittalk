import SwiftUI

#if os(macOS)
import AppKit

final class MacAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// 起動直後に、絞り込み欄へ勝手にフォーカスが入るので外す (クリックしたときだけ入力できるように)
    func applicationDidFinishLaunching(_ n: Notification) {
        // 前回のウィンドウの大きさは使わず、いつも同じ大きさで起動する
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { NSApp.windows.first?.setContentSize(NSSize(width: 448, height: NSApp.windows.first?.contentRect(forFrameRect: NSApp.windows.first!.frame).height ?? 700)) }
        for d in [0.5, 1.2, 2.5] { DispatchQueue.main.asyncAfter(deadline: .now() + d) { MacWindow.refit() } } // ウィンドウの復元で大きさが戻されても、合わせ直す
        for d in [0.3, 1.0, 2.0] { DispatchQueue.main.asyncAfter(deadline: .now() + d) { NSApp.keyWindow?.makeFirstResponder(nil) } }
    }
    /// アプリに戻ったとき、勝手に入力欄にフォーカスが戻るのを外す (入力欄をクリックして戻ったときは、そのまま)
    func applicationDidBecomeActive(_ n: Notification) {
        DispatchQueue.main.async {
            if NSApp.currentEvent?.type != .leftMouseDown, NSApp.keyWindow?.firstResponder is NSText { NSApp.keyWindow?.makeFirstResponder(nil) }
        }
    }

    /// 物理キーボードで、モールスを送る (画面のキーボードと同じ: 文字・数字・記号、⌫、ESC)。F-A-X と打つと FAX モード (⏎ で送信)。
    /// 入室中で、文字入力中でないときだけ。
    private func morseFromKeyboard(_ e: NSEvent) -> Bool {
        guard e.type == .keyDown, !e.isARepeat, PochiEngine.shared.ui.currentKey != nil else { return false }
        let code: String
        switch e.keyCode {
        case 51: code = "BS"
        case 36, 76: code = "ENTER"
        case 53: code = "ESC"
        case 48: if PochiEngine.shared.ui.faxCompose == nil { return false }; code = "TAB"
        default:
            if PochiEngine.shared.ui.faxCompose != nil {
                // FAX モード: 大文字・小文字・記号を、打ったとおりに入れる
                guard let c = e.characters?.first, let a = c.asciiValue, a >= 0x21, a <= 0x7E else { return false }
                code = String(c)
            } else {
                guard let c = e.characters?.uppercased().first, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?!/-:".contains(c) else { return false }
                code = String(c)
            }
        }
        PochiEngine.shared.morseKey(code)
        return true
    }

    private var spaceDown = false
    private var monitor: Any?
    /// スペースキーを押している間だけ話す。文字を入力している最中 (ニックネーム欄など) は、ふつうに入力できるように何もしない。
    func installSpaceToTalk() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] e in
            guard let self, e.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return e }
            if NSApp.keyWindow?.firstResponder is NSText { return e }
            if NSApp.keyWindow?.attachedSheet != nil { return e }
            if MacWindow.dialOpen { // ダイヤルが開いているとき: ↑↓ で回す / Enter で入室 / Esc で閉じる (Web 版と同じ)
                if e.type == .keyDown, !e.isARepeat || e.keyCode == 125 || e.keyCode == 126 {
                    switch e.keyCode {
                    case 126: NotificationCenter.default.post(name: .pochiDial, object: "up"); return nil
                    case 125: NotificationCenter.default.post(name: .pochiDial, object: "down"); return nil
                    case 36, 76: NotificationCenter.default.post(name: .pochiDial, object: "enter"); return nil
                    case 53: NotificationCenter.default.post(name: .pochiMenu, object: "dial"); return nil
                    default: break
                    }
                }
            }
            let fax = PochiEngine.shared.ui.faxCompose != nil
            if e.keyCode == 49 && fax { // FAX モードでは、スペースは空白 (話すキーにはならない)
                if e.type == .keyDown, !e.isARepeat { PochiEngine.shared.morseKey(" ") }
                return nil
            }
            if e.keyCode != 49 { return self.morseFromKeyboard(e) ? nil : e } // スペース以外: モールス / FAX
            if e.type == .keyDown {
                if !e.isARepeat, !self.spaceDown { self.spaceDown = true; PochiEngine.shared.pttPress() }
            } else if self.spaceDown {
                self.spaceDown = false; PochiEngine.shared.pttRelease()
            }
            return nil
        }
    }
}
#endif

@main
struct PochitalkApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var macDelegate
    @Environment(\.openWindow) private var openWindow
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var engine = PochiEngine.shared

    init() {
        PochiEngine.shared.start()
        #if os(macOS)
        MacWindow.install()
        DispatchQueue.main.async { [macDelegate] in macDelegate.installSpaceToTalk() }
        #endif
        // テスト用: 起動時に部屋へ入る (シミュレーターで画面や通信を確かめるため。通常の起動では使わない)
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-autojoin"), i + 1 < args.count {
            // 接続の準備ができるまで (リレーの確認に時間がかかることがある)、入れるまで繰り返す
            for n in 0..<10 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 6 + Double(n) * 4) {
                    if PochiEngine.shared.ui.currentKey != args[i + 1] { PochiEngine.shared.join(args[i + 1]) }
                }
            }
            // 開発用: 一覧にだけいる (つながらない) 人を作る。赤いチップの確認用
            if let j = args.firstIndex(of: "-fakepeer"), j + 1 < args.count {
                for n in 0..<30 { // 一覧の有効期限 (20 秒) より短い間隔で送り続ける
                    DispatchQueue.main.asyncAfter(deadline: .now() + 12 + Double(n) * 8) { PochiEngine.shared.debugFakePresence(args[i + 1], args[j + 1]) }
                }
            }
            if args.contains("-autovox") { DispatchQueue.main.asyncAfter(deadline: .now() + 9) { PochiEngine.shared.setVox(true) } }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            PochiRoot(engine: engine)
                #if os(macOS)
                .frame(minWidth: 448, minHeight: 300) // 高さは、本体の高さに合わせて、ウィンドウ側で決める (MacWindow.fit)
                #endif
                .onOpenURL { url in
                    if let key = PochiEngine.roomKey(from: url) { PochiEngine.shared.setPendingKey(key) }
                }
                .onChange(of: scenePhase) { phase in
                    switch phase {
                    case .background: PochiEngine.shared.onAppBackground()
                    case .active: PochiEngine.shared.onAppForeground()
                    default: break
                    }
                }
        }
        #if os(macOS)
        .defaultSize(width: 448, height: 700)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("部屋を探す（ダイヤルを開く）") { NotificationCenter.default.post(name: .pochiMenu, object: "dial") }.keyboardShortcut("k")
                Button("新しい部屋を作る") { NotificationCenter.default.post(name: .pochiMenu, object: "new") }.keyboardShortcut("n")
                Button("この部屋から退出") { NotificationCenter.default.post(name: .pochiMenu, object: "leave") }.keyboardShortcut("l")
                Button("再接続") { NotificationCenter.default.post(name: .pochiMenu, object: "reconnect") }.keyboardShortcut("r")
                Divider()
                Button("招待URLをコピー") {
                    if let k = PochiEngine.shared.ui.currentKey, let u = PochiEngine.shared.inviteUrl(for: k) {
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(u, forType: .string)
                    }
                }.keyboardShortcut("c", modifiers: [.command, .shift])
            }
            CommandGroup(after: .toolbar) {
                Button("ログを表示") { openWindow(id: "log") }.keyboardShortcut("l", modifiers: [.command, .option])
            }
            CommandGroup(replacing: .appSettings) {
                Button("設定…") { NotificationCenter.default.post(name: .pochiMenu, object: "settings") }.keyboardShortcut(",")
            }
        }
        #endif
        #if os(macOS)
        Window("ぽちっと通話 ログ", id: "log") { LogWindowView(engine: engine) }
            .defaultSize(width: 560, height: 360)
        #endif
    }
}
