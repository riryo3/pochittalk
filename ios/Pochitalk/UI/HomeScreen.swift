import SwiftUI

// 画面の土台は RadioScreen (入室前も同じ画面)。ここには、初回案内だけを置く。

extension View {
    /// 中身が画面に収まるときは、引っ張ってもスクロールしない (iOS 16.4 以降)。
    @ViewBuilder func scrollBounceIfNeeded() -> some View {
        if #available(iOS 16.4, *) { self.scrollBounceBehavior(.basedOnSize) } else { self }
    }

    @ViewBuilder func scrollDismissesKeyboardCompat() -> some View {
        if #available(iOS 16.0, *) { self.scrollDismissesKeyboard(.interactively) } else { self }
    }
}

/// 初回案内 (起動したときだけ出す)。
struct WelcomeView: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    let onSettings: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showAbout = false
    @State private var agreed = WelcomeView.consented()

    /// 同意した版 (日付)。版が変わったら、もう一度確認する。
    static let consentVersion = "2026-11-10"
    static func consented() -> Bool { UserDefaults.standard.string(forKey: "pochitalk_consent") == consentVersion }
    /// 起動時に出すか: 同意がまだ (または版が変わった) ときは必ず、そうでなければ「次回も表示する」の設定どおり。
    static func needed() -> Bool { !consented() || UserDefaults.standard.string(forKey: "pochitalk_welcome") != "off" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("はじめにご確認ください。").foregroundStyle(PC.text)
                    Text("声が相手に十分な大きさで届くよう、入力レベルを調整できます。").font(.system(size: 13)).foregroundStyle(PC.text)
                    Button { onSettings() } label: { Text("マイクを設定する").frame(maxWidth: .infinity) }.buttonStyle(SubButtonStyle(container: PC.chip))
                    Text("使い方と、プライバシー（見える情報、保存されるもの）を説明しています。").font(.system(size: 13)).foregroundStyle(PC.text)
                    Button { showAbout = true } label: { Text("このアプリについて").frame(maxWidth: .infinity) }.buttonStyle(SubButtonStyle(container: PC.chip))
                    Toggle("次回も表示する", isOn: Binding(get: { ui.welcomeOn }, set: { engine.setWelcomeOn($0) })).foregroundStyle(PC.text)
                    Button { agreed.toggle() } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: agreed ? "checkmark.square.fill" : "square").font(.system(size: 22)).foregroundStyle(agreed ? Color(hex: 0x60A5FA) : PC.muted)
                            Text("「このアプリについて」を読み、次のことを了解しました。個人が作ったα版で、動作や安全性の保証はありません。部屋は公開で、知らない人にも声が聞こえます。人数が多いと、つながりにくくなることがあります。**自己責任で使います。**")
                                .font(.system(size: 13)).foregroundStyle(PC.text).multilineTextAlignment(.leading)
                        }
                    }
                    .buttonStyle(.plain)
                    Button {
                        UserDefaults.standard.set(Self.consentVersion, forKey: "pochitalk_consent")
                        dismiss()
                    } label: { Text("はじめる").frame(maxWidth: .infinity) }
                        .buttonStyle(SubButtonStyle(container: Color(hex: 0x2563EB)))
                        .disabled(!agreed)
                }.padding(16)
            }
            .background(PC.bg)
            .navigationTitle("ようこそ").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showAbout) { AboutView() }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(!agreed) // 同意するまで、閉じられない
        .preferredColorScheme(.dark)
    }
}

/// 入室していないときの「本体」: ダイヤルの赤い線に合わせた部屋の様子と、大きなボタン。
/// 招待リンクで開いた → 「JOIN 入室」 / どこにも入っていない → 「NEW 新しい部屋」。
private struct HomeBody: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    let focusKey: String?
    let onAbout: () -> Void

    var body: some View {
        let invited = ui.pendingKey
        let shownKey = invited ?? focusKey
        let room = shownKey.flatMap { k in ui.rooms.first { $0.key == k } }
        VStack(spacing: 12) {
            VStack(spacing: 2) {
                Text(invited != nil ? "招待された部屋" : "ダイヤルの部屋").font(.system(size: 12, design: .monospaced)).tracking(3).foregroundStyle(PC.muted)
                Text(shownKey.map(formatKey) ?? "– – – –").font(.system(size: 38, weight: .black, design: .monospaced)).foregroundStyle(PC.sky)
                    .minimumScaleFactor(0.6).lineLimit(1)
            }
            if let room {
                if !room.tag.isEmpty {
                    Text("🏷 " + room.tag + (room.tagBy.isEmpty ? "" : "（\(room.tagBy)）")).font(.system(size: 13)).foregroundStyle(Color(hex: 0x93C5FD))
                }
                Text(room.count == 0 ? "いま誰もいません" : "👤\(room.count)　" + room.names.joined(separator: "、"))
                    .font(.system(size: 13)).foregroundStyle(PC.muted).multilineTextAlignment(.center)
            }
            HStack {
                Spacer()
                Text("入室していません").font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundStyle(PC.muted)
            }
            Button {
                if let invited { engine.join(invited) } else { engine.createRoom() }
            } label: {
                ZStack {
                    Circle().fill(RadialGradient(colors: [Color(hex: 0x22C55E), Color(hex: 0x15803D)], center: .center, startRadius: 0, endRadius: 100))
                    Circle().stroke(Color(hex: 0x14532D), lineWidth: 6)
                    VStack(spacing: 2) {
                        Text(invited != nil ? "JOIN" : "NEW").font(.system(size: 26, weight: .black)).foregroundStyle(.white)
                        Text(invited != nil ? "入室" : "新しい部屋").font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.9))
                    }
                }
                .frame(width: 150, height: 150)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(invited != nil ? "入室" : "新しい部屋を作る")
            if invited != nil {
                HStack(spacing: 8) {
                    Button("あとで") { engine.setPendingKey(nil) }.buttonStyle(SubButtonStyle(small: true))
                    Button("新しい部屋を作る") { engine.setPendingKey(nil); engine.createRoom() }.buttonStyle(SubButtonStyle(small: true))
                }
            }
            Button("使い方・プライバシー", action: onAbout).buttonStyle(SubButtonStyle(container: PC.chip, small: true))
        }
        .frame(maxWidth: .infinity)
    }
}
