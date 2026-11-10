import SwiftUI

/// 画面下のモールス用 QWERTY キーボード (Web 版の .morse-drawer)。入室中だけ出す。見出しを押すと開閉。スペースは無い。
struct MorseKeyboard: View {
    let ui: UiState
    @State private var open = false
    private let rows = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM", ".,?!/-:"]

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeOut(duration: 0.2)) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Text("⌨ モールスで送る").font(.system(size: 14)).foregroundStyle(PC.text)
                    Spacer(minLength: 4)
                    Text(ui.morseText.isEmpty ? "" : "送信待ち " + ui.morseText)
                        .font(.system(size: 13, design: .monospaced)).foregroundStyle(PC.sky).lineLimit(1).truncationMode(.head)
                    Text(open ? "▼ 閉じる" : "▲ 開く").font(.system(size: 13)).foregroundStyle(PC.text)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Rectangle().fill(Color(hex: 0x1F2937)).frame(height: 1)
            if open {
                VStack(spacing: 4) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { ri, r in
                        HStack(spacing: 4) {
                            if ri == 3 { key("ESC", wide: true) }
                            ForEach(Array(r), id: \.self) { c in key(String(c), wide: false) }
                            if ri == 3 { key("⌫", wide: true, code: "BS") }
                            if ri == 4 && ui.faxCompose != nil { key("⏎", wide: true, code: "ENTER") } // FAX モードのときだけ: 送信
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
                .padding(.horizontal, 6).padding(.top, 4).padding(.bottom, 10)
            }
        }
        .background(UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14).fill(Color(hex: 0x252B36)).ignoresSafeArea(edges: .bottom)) // 下の安全領域 (ホームバーの下) も、同じ色で埋める
        .overlay(UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14).stroke(Color(hex: 0x374151), lineWidth: 1).ignoresSafeArea(edges: .bottom))
        .shadow(color: .black.opacity(0.5), radius: 10, y: -4)
    }

    private func key(_ label: String, wide: Bool, code: String? = nil) -> some View {
        Button { PochiEngine.shared.morseKey(code ?? label) } label: {
            Text(label).font(.system(size: wide ? 13 : 16)).foregroundStyle(Color(hex: 0xE5E7EB))
                .frame(minWidth: 0, maxWidth: wide ? 64 : 38).frame(height: 42)
                .background(Color(hex: 0x1F2937), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x374151), lineWidth: 1))
        }
        .buttonStyle(MorseKeyStyle())
    }
}

private struct MorseKeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.overlay(configuration.isPressed ? RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0x2563EB)) : nil)
    }
}

/// カードを、横にひっくり返す (表 = 本体、裏 = QR)。角度で表と裏を切り替え、途中の 90 度で入れ替わる。
struct FlipCard<Front: View, Back: View>: View, Animatable {
    var angle: Double
    let front: Front
    let back: Back

    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    var body: some View {
        ZStack {
            front.opacity(angle < 90 ? 1 : 0)
                .rotation3DEffect(.degrees(angle), axis: (0, 1, 0), perspective: 0.5)
                .allowsHitTesting(angle < 90)
            back.opacity(angle >= 90 ? 1 : 0)
                .rotation3DEffect(.degrees(angle - 180), axis: (0, 1, 0), perspective: 0.5)
                .allowsHitTesting(angle >= 90)
        }
    }
}
