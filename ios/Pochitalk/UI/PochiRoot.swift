import SwiftUI

/// 画面の土台。ロビーはホーム画面、入室後は無線機画面。
struct PochiRoot: View {
    @ObservedObject var engine: PochiEngine

    var body: some View {
        ZStack {
            PC.bg.ignoresSafeArea()
            RadioScreen(ui: engine.ui, engine: engine)
        }
        .preferredColorScheme(.dark)
        #if DEBUG
        .overlay(alignment: .bottom) {
            // 開発用: 起動引数 -showdiag で、接続の記録を画面の下に重ねて出す (リリースビルドには入らない)
            if ProcessInfo.processInfo.arguments.contains("-showdiag") {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(engine.diagLines.suffix(9).enumerated()), id: \.offset) { _, l in
                        Text(l).font(.system(size: 9, design: .monospaced)).foregroundStyle(.green).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(6).background(.black.opacity(0.8)).allowsHitTesting(false)
            }
        }
        #endif
    }
}
