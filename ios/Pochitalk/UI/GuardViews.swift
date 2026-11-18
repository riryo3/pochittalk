import SwiftUI

/// 自衛リスト用の配色 (くすんだ茶色)
enum GuardColor {
    static let bg = Color(hex: 0x3B2418)
    static let fg = Color(hex: 0xD6A28A)
    static let edge = Color(hex: 0x9A3412)
}

/// 通報の確認: フォームに入れる内容を見せて、外のブラウザで開く。
struct ReportSheet: View {
    let peer: PeerInfo
    let roomKey: String
    let engine: PochiEngine
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var alsoMute = true
    @State private var alsoWord = false
    @State private var time = Guard.nowText()

    private var already: Bool { peer.muted }
    private var canMute: Bool { !peer.uid.isEmpty && !already }

    var body: some View {
        NavigationStack {
            Form {
                Section("フォームに入れる内容") {
                    row("相手の名前", peer.name)
                    row("相手の目印 (uid)", peer.uid.isEmpty ? "（不明）" : peer.uid)
                    row("部屋 ID", roomKey)
                    row("時刻", time)
                    Text("通報する人の情報は入れません。「フォームを開く」で、外のブラウザに通報フォームが開きます。").font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    if canMute { Toggle("この相手を、ミュートにも登録する", isOn: $alsoMute) }
                    Toggle("この名前を、嫌な言葉にも登録する", isOn: $alsoWord)
                }
                Section {
                    Button("フォームを開く") {
                        if canMute && alsoMute { engine.addGuardId(peer.uid, name: peer.name) }
                        if alsoWord { engine.addGuardWord(peer.name) }
                        if let u = Guard.reportURL(name: peer.name, uid: peer.uid.isEmpty ? nil : peer.uid, room: roomKey, time: time) { openURL(u) }
                        dismiss()
                    }
                }
            }
            .scrollContentBackground(.hidden).background(PC.bg)
            .navigationTitle("通報する").inlineNavTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 420)
        #endif
    }

    private func row(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.footnote).foregroundStyle(.secondary)
            Text(v).font(.system(size: 14, design: .monospaced)).textSelection(.enabled)
        }
    }
}

/// 設定の「自衛リスト」節: ① 嫌な言葉 ② ミュートする相手 ③ 一致した部屋の扱い
struct GuardSettingsSection: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    @State private var word = ""
    @State private var uid = ""
    @State private var memo = ""
    @State private var delWord: String?
    @State private var error: String?

    var body: some View {
        Section("自衛リスト") {
            Text("この端末の中だけに保存します（外へは送りません）。").font(.footnote).foregroundStyle(.secondary)
            Text("① 嫌な言葉").font(.subheadline.bold())
            HStack {
                TextField("言葉（20文字まで）", text: $word).noAutoCap().onSubmit(addWord)
                Button("追加", action: addWord).disabled(word.trimmingCharacters(in: .whitespaces).isEmpty || ui.guardWords.count >= Guard.maxWords)
            }
            if !ui.guardWords.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(ui.guardWords, id: \.self) { w in
                        Button { delWord = w } label: {
                            Text(w + " ✕").font(.system(size: 13)).foregroundStyle(GuardColor.fg)
                                .padding(.horizontal, 10).padding(.vertical, 4).background(GuardColor.bg, in: Capsule())
                        }.buttonStyle(.plain)
                    }
                }
            }
            Text("相手の名前と、部屋の話題タグに、この言葉が入っていると、色を変えます（大文字小文字・全角半角・カタカナ/ひらがなの違いは無視）。自分の名前は対象外です。").font(.footnote).foregroundStyle(.secondary)

            Text("② ミュートする相手").font(.subheadline.bold()).padding(.top, 6)
            if ui.guardIds.isEmpty { Text("（登録している相手はいません）").font(.footnote).foregroundStyle(.secondary) }
            ForEach(ui.guardIds) { g in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(g.name.isEmpty ? "（名前なし）" : g.name)
                        Text(g.uid).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("解除") { engine.removeGuardId(g.uid) }
                }
            }
            TextField("相手の目印（16桁の英数字）", text: $uid).noAutoCap().font(.system(size: 14, design: .monospaced))
            HStack {
                TextField("メモ（名前など）", text: $memo).noAutoCap()
                Button("追加") {
                    let u = uid.trimmingCharacters(in: .whitespaces).lowercased()
                    if !Guard.isUid(u) { error = "目印は、16桁の英数字（0-9, a-f）で入れてください"; return }
                    if u == ui.myUid { error = "自分の目印は登録できません"; return }
                    error = nil; engine.addGuardId(u, name: memo); uid = ""; memo = ""
                }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(PC.amber) }
            Text("登録した相手が部屋に入ると、声を自動で消し、注意音と知らせを出します。部屋の中で、相手の名前をタップ（Mac はクリック）しても登録できます。あなたの目印: \(ui.myUid)").font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)

            Text("③ 一致した部屋の扱い").font(.subheadline.bold()).padding(.top, 6)
            Picker("一致した部屋", selection: Binding(get: { ui.guardMode }, set: { engine.setGuardMode($0) })) {
                Text("色を変える").tag("warn"); Text("一覧から隠す").tag("hide")
            }.pickerStyle(.segmented)
            Text("「色を変える」では、一致した部屋に入る前に、確認を出します。いま入っている部屋は、隠れません。").font(.footnote).foregroundStyle(.secondary)
        }
        .alert("この言葉を消しますか？", isPresented: Binding(get: { delWord != nil }, set: { if !$0 { delWord = nil } })) {
            Button("消す", role: .destructive) { if let w = delWord { engine.removeGuardWord(w) }; delWord = nil }
            Button("キャンセル", role: .cancel) { delWord = nil }
        } message: { Text(delWord ?? "") }
    }

    private func addWord() {
        let t = word.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { engine.addGuardWord(t) }
        word = ""
    }
}
