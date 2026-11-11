#if os(macOS)
import AppKit
import SwiftUI

/// Mac: 接続の記録 (診断ログ) を、別ウィンドウに出しっぱなしにできる。新しい行が来たら、いちばん下まで流れる。
struct LogWindowView: View {
    @ObservedObject var engine: PochiEngine
    @State private var follow = true

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        if engine.diagLines.isEmpty {
                            Text("まだ記録がありません。部屋に入ると、接続の様子が流れます。").font(.system(size: 12)).foregroundStyle(PC.muted)
                        }
                        ForEach(Array(engine.diagLines.enumerated()), id: \.offset) { i, l in
                            Text(l).font(.system(size: 11, design: .monospaced)).foregroundStyle(PC.text.opacity(0.9))
                                .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).id(i)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(10)
                }
                .onChange(of: engine.diagLines.count) { _ in if follow { proxy.scrollTo("bottom", anchor: .bottom) } }
                .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            Divider().overlay(Color(hex: 0x2D3748))
            HStack(spacing: 10) {
                Toggle("自動で下まで流す", isOn: $follow).toggleStyle(.checkbox).font(.system(size: 12))
                Spacer()
                Text("\(engine.diagLines.count) 行").font(.system(size: 11, design: .monospaced)).foregroundStyle(PC.muted)
                Button("コピー") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(engine.diagLines.joined(separator: "\n"), forType: .string)
                }
                Button("消去") { engine.clearDiagLines() }
            }
            .padding(8)
        }
        .background(PC.bg)
        .preferredColorScheme(.dark)
        .frame(minWidth: 360, minHeight: 200)
    }
}
#endif
