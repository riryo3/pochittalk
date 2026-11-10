import SwiftUI

@main
struct PochitalkApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var engine = PochiEngine.shared

    init() {
        PochiEngine.shared.start()
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
    }
}
