import SwiftUI

/// 設定: マイク (入力レベル・マイクテスト)、話すボタンの位置、効果音、ロック中の使い方、このアプリについて。
struct SettingsView: View {
    let ui: UiState
    @ObservedObject var engine: PochiEngine
    @Environment(\.dismiss) private var dismiss
    @State private var showAbout = false
    @State private var showDiag = false

    var body: some View {
        NavigationStack {
            Form {
                Section("マイク") {
                    switch ui.micPermission {
                    case .granted: Label("マイクは許可されています", systemImage: "checkmark.circle").foregroundStyle(PC.rx)
                    case .undetermined: Button("マイクの許可をたずねる") { engine.requestMic() }
                    case .denied:
                        Text("マイクが許可されていません。").foregroundStyle(PC.amber)
                        Button(openSettingsLabel) { openSystemSettings() }
                    }
                    VStack(alignment: .leading) {
                        HStack { Text("入力レベル"); Spacer(); Text("+\(ui.micGainDb) dB").font(.system(.body, design: .monospaced)).foregroundStyle(PC.sky) }
                        Slider(value: Binding(get: { Double(ui.micGainDb) }, set: { engine.setMicGainDb(Int($0.rounded())) }), in: 0...30, step: 1)
                        Text("声が小さく伝わるときは上げてください。VOX のしきい値やメーターにも反映されます。").font(.footnote).foregroundStyle(.secondary)
                    }
                    Toggle("マイクテスト", isOn: Binding(get: { ui.micTest }, set: { engine.setMicTest($0) }))
                        .disabled(ui.currentKey != nil)
                    if ui.micTest || ui.currentKey != nil {
                        LevelMeter(meter: engine.meter)
                    }
                    Text("マイクテストは、入力レベルとメーターの確認のためにマイクを使います。音声は送信も保存もされません。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("話すボタン") {
                    Picker("位置", selection: Binding(get: { ui.pttPos }, set: { engine.setPttPosition($0) })) {
                        Text("左").tag(PttPosition.left); Text("中央").tag(PttPosition.center); Text("右").tag(PttPosition.right)
                    }.pickerStyle(.segmented)
                    Text("VOX のボタンは、話すボタンの空いている側に付きます。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("自動で再接続する", isOn: Binding(get: { ui.autoReconnect }, set: { engine.setAutoReconnect($0) }))
                    Text("オフのときは、つながらなくなっても自動ではやり直しません。部屋の「再接続」ボタンを押してください。").font(.footnote).foregroundStyle(.secondary)
                    Toggle("左手用（VOX ボタンを右側に）", isOn: Binding(get: { ui.lefty }, set: { engine.setLefty($0) }))
                }
                Section("効果音") {
                    HStack { Text("音量"); Spacer(); Text("\(ui.sfxVolume)%").font(.system(.body, design: .monospaced)).foregroundStyle(PC.sky) }
                    Slider(value: Binding(get: { Double(ui.sfxVolume) }, set: { engine.setSfxVolume(Int($0.rounded())) }), in: 0...150, step: 5) { editing in
                        if !editing { engine.previewSfx() }
                    }
                    Text("スライダーを離すと、試しに発話終了の「ガッ」と鳴ります。効果音を消したいときは、音量を 0% にしてください。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("新しい部屋") {
                    Toggle("新しい部屋ができたら、音で知らせる", isOn: Binding(get: { ui.notifyRoom }, set: { engine.setNotifyRoom($0) }))
                    Text("音だけで知らせます（画面の知らせや、OS の通知は出しません）。効果音がオンのときに鳴ります。オンにすると、確かめに1回鳴ります。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("通信の記録") {
                    Toggle("通信の記録を、この端末に残す", isOn: Binding(get: { ui.logRec }, set: { engine.setLogRec($0) }))
                    Text("オフのとき（標準）は、通信の記録をこの端末に保存せず、画面の中（メモリ）だけに置きます。オンにすると、最大300行をこの端末に保存します（外部へは送りません。オフにすると消します）。オンの間は、ハンドルネームの前に 💾 が付き、同じ部屋の人にも見えます。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("画面を消しているとき") {
                    Text("部屋に入っている間は、画面を消したり、ほかのアプリを開いたりしても通話が続き、VOX も使えます（画面上部にマイクの表示が出ます）。部屋を出ると、マイクを手放します。").font(.footnote)
                    Text("電話がかかってきたときは通話が一時止まり、終わると自動で戻ります。").font(.footnote).foregroundStyle(.secondary)
                }
                Section("このアプリについて") {
                    Button("使い方・プライバシー・ライセンス") { showAbout = true }
                    Link("GitHub: riryo3/pochittalk", destination: URL(string: "https://github.com/riryo3/pochittalk")!)
                    Link("元のアプリ: ぽっと通話 (potalk.app)", destination: URL(string: "https://potalk.app/")!)
                    Link("元のソース: github.com/qramo/po_call", destination: URL(string: "https://github.com/qramo/po_call")!)
                    Text("© qramo, © リョータ\nMIT License").font(.footnote).foregroundStyle(.secondary)
                    Text("バージョン \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"))")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("診断") {
                    Toggle("接続の記録を表示", isOn: $showDiag)
                    if showDiag {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ui.audioRunning ? "音声ユニット: 動作中" : "音声ユニット: 停止中").font(.footnote)
                            ForEach(Array(engine.diagLines.enumerated()), id: \.offset) { _, l in
                                Text(l).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            #if os(macOS)
            .formStyle(.grouped) // Mac: 項目ごとに枠でまとめて、ラベルと値を揃える
            #endif
            .scrollContentBackground(.hidden)
            .background(PC.bg)
            .navigationTitle("設定").inlineNavTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
            .sheet(isPresented: $showAbout) { AboutView() }
            .onDisappear { engine.setMicTest(false) }
        }
        .preferredColorScheme(.dark)
        #if os(macOS)
        .frame(minWidth: 420, idealWidth: 420, minHeight: 560, idealHeight: 640)
        #endif
    }
}
