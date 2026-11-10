import SwiftUI

/// 「このアプリについて」の本文。Web 版 (worker.js) と Android 版の説明を、iPhone 版の実装に合わせて書き直したもの。
/// 「**太字**」は表示時に太字になる。保存・送信するデータを変えたら、必ずここも更新すること。
enum AboutBlock {
    case paragraph(String)
    case sub(String)
    case bullets([String])
}

struct AboutSection: Identifiable {
    let title: String
    let blocks: [AboutBlock]
    var id: String { title }
}

let aboutSections: [AboutSection] = [
    AboutSection(title: "このアプリは？", blocks: [
        .paragraph("ボタンを押している間だけ話せる、トランシーバー風の音声通話アプリです。アカウント登録やログインは要りません。同じ部屋に入った人どうしで話せます。Web版・Android版とも同じ部屋で話せます。α版のため、予告なく仕様が変わったり、動作が不安定だったりすることがあります。"),
    ]),
    AboutSection(title: "使い方", blocks: [
        .bullets([
            "ハンドルネームを決めて、「新しい部屋を作る」か、一覧の部屋をタップして入ります。",
            "入室後は、大きなボタンを押している間だけ話せます。",
            "「招待」でURLを友達に送るか、QRコードを見せると、同じ部屋に入れます。",
            "誰かが話している間は話せません（話中）。同時に押すと混線して、どちらも送信が切れます。",
            "部屋の中では、「話題タグ」をつけられます（30文字まで）。誰でも変えられ、付けた人の名前が添えられます。部屋の一覧にも表示されます。",
            "相手が見つからない、声が届かなくなったときは、「再接続」を押すと、部屋に入ったまま接続をやり直します。回線が切り替わったときや、しばらく離れて戻ったとき（通話中でなければ）は、自動でつなぎ直します。",
            "VOXをオンにすると、声を拾って自動で送信します（イヤホン推奨）。部屋を出る、または部屋を変えると、VOXはオフに戻ります。",
            "人数の目安は1部屋あたり6〜8人までです（8人が上限）。",
            "部屋に入っている間は、画面を消したり他のアプリを開いたりしても通話が続き、VOXも使えます。画面の上にマイクの表示が出ます。",
        ]),
    ]),
    AboutSection(title: "プライバシー", blocks: [
        .sub("誰に何が見えるか"),
        .bullets([
            "**ハンドルネーム・今いる部屋・話し中かどうか**は、このアプリ（Web版・Android版を含む）を同時に開いている全員に見えます（部屋一覧のため）。本名や個人が特定できる名前は使わないでください。",
            "**話題タグ**と、付けた人のハンドルネームも、一覧で全員に見えます。個人情報は書かないでください。",
            "**部屋は公開です。**部屋のハッシュ値は一覧に出るので、誰でもタップして入れます。秘密の話をする用途には向いていません。",
            "**同じ部屋の人には、あなたのIPアドレスが見える**ことがあります。通話が端末どうしの直接通信（P2P）で行われるためです。",
            "同じ部屋の誰かが、自分の端末で通話を録音する可能性はあります。このアプリには防ぐ仕組みはありません。",
        ]),
        .sub("音声について"),
        .bullets([
            "音声は、通常、端末どうしで直接送られます。直接つながれない場合だけ、CloudflareのTURNサーバーを中継して送られます。通信にはWebRTCの標準の暗号化がかかるため、中継サーバーが内容を聞くことはできません。",
            "このアプリの運営側は、音声を受け取らず、録音も保存もしません（そもそも運営側のサーバーに届きません）。",
            "マイクは、初めて使うときに許可を求めます。部屋に入っている間は、すぐ話せるように、そして画面を消していてもVOXが使えるように、マイクを動かし続けます（その間、画面の上にマイクの表示が出ます）。ボタンを押していない間（VOXが声を検出していない間）は、音声を何も送りません。部屋を退出すると、マイクを手放します。",
            "VOX（声で自動送信）をオンにすると、声を検出するために端末の中でマイクの音量を監視します。この監視用の音は送信も保存もされず、声を検出したときだけ送信が始まります。同じ理由で、部屋に入っている間は、画面のレベル表示のためにも端末の中で音量を測っています。設定の「マイクテスト」は、入力レベルとメーターの確認のためにマイクを使いますが、音声は送信も保存もされません。VOX自体は、アプリを開き直すとオフに戻ります（しきい値の設定だけ、端末に保存されます）。",
        ]),
        .sub("あなたの端末に保存されるもの"),
        .bullets([
            "**ハンドルネーム**: このアプリの設定領域（UserDefaults）に保存され、次回起動時に入力済みになります。端末の外には保存されません。アプリを削除すると消えます。",
            "**話すボタンの位置・左手用の設定・効果音の音量・入力レベル（0〜30dB）・VOXのしきい値（1〜10）・初回案内の表示設定**: 同じく UserDefaults に保存します。この端末の中だけにあり、運営側には送られません。",
            "**「利用上の注意」に同意したという記録**（同意した版の日付）: 同じく UserDefaults に保存します。版が変わると、もう一度確認します。",
            "**「新しい部屋ができたら、音で知らせる」の設定**: オン・オフだけを、同じく UserDefaults に保存します。",
            "**通信の記録（診断ログ）**: 標準では、端末に保存しません（画面の中＝メモリだけで、アプリを閉じると消えます）。設定の「通信の記録を、この端末に残す」をオンにしたときだけ、最大300行を UserDefaults に保存します。外部へは送りません。オフにすると消えます。オンの間は、ハンドルネームの前に 💾 が付き、同じ部屋の人にも見えます。一般の方は、オンにしない限り、記録は残りません。",
            "招待リンクで開いた部屋は、一覧に表示するためにアプリの実行中だけ覚えます。保存はしません。",
            "アカウント、メールアドレス、位置情報、連絡先などは、保存も取得もしません。",
            "アクセス解析や広告の仕組みは入れていません。",
        ]),
        .sub("サーバー側に保存されるもの"),
        .bullets([
            "このアプリの運営側には、データベースや保存領域がなく、ユーザーの名前・部屋・音声・通話履歴を保存していません。",
            "**おうむ返しボット**は、動作の確認のために通信の記録（ログ）を残します。ただし、話された内容（音声）は覚えていません。",
            "Web版を配信している Cloudflare には、TURN（中継）の一時的な認証情報を受け取るためだけに接続します（このアプリには、TURNの鍵そのものは入っていません）。この接続でも、IPアドレスなどの一般的なアクセス情報が記録されることがあります。",
        ]),
        .sub("外部のサービスについて"),
        .bullets([
            "**Nostr の公開リレー（動いているものすべて。通話用にも、部屋一覧用にも使います）**: 通話相手を見つけるための接続情報のやり取りと、部屋の一覧のための在室の知らせ（部屋のハッシュ、ハンドルネーム、話題タグ、話しているか）の送受信に使います。接続情報は暗号化されますが、在室の知らせは暗号化されません。接続元IPなどのアクセス情報も、リレーの運営者に見える可能性があります。",
            "**STUN / TURNサーバー（Cloudflare・Google）**: 端末どうしが直接つながるための、公開されたアドレスの確認と、直接つなげないときの中継に使います。IPアドレスがこれらに送られます。",
            "これらは運営側が管理していない外部のサービスです。",
        ]),
    ]),
    AboutSection(title: "ご注意", blocks: [
        .bullets([
            "個人が作ったα版です。動作や安全性は保証できません。重要な連絡や緊急時の連絡には使わないでください。",
            "回線やNATの種類によっては、相手とつながらないことがあります。",
            "他人への迷惑行為や、他人の会話の録音・公開はしないでください。",
        ]),
    ]),
]

private let mitText = """
MIT License

Copyright (c) 2026 qramo (original work: https://github.com/qramo/po_call)
Copyright (c) 2026 リョータ (modifications)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(aboutSections) { sec in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(sec.title).font(.system(size: 18, weight: .bold)).foregroundStyle(PC.sky)
                            ForEach(Array(sec.blocks.enumerated()), id: \.offset) { _, b in block(b) }
                        }
                    }
                    credits
                }.padding(16)
            }
            .background(PC.bg)
            .navigationTitle("このアプリについて").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private func block(_ b: AboutBlock) -> some View {
        switch b {
        case .paragraph(let t): Text(md(t)).font(.system(size: 14)).foregroundStyle(PC.text)
        case .sub(let t): Text(t).font(.system(size: 15, weight: .bold)).foregroundStyle(PC.text).padding(.top, 6)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, t in
                    HStack(alignment: .top, spacing: 6) { Text("•").foregroundStyle(PC.muted); Text(md(t)).font(.system(size: 13)).foregroundStyle(PC.text) }
                }
            }
        }
    }

    private func md(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }

    private var credits: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("クレジットとライセンス").font(.system(size: 18, weight: .bold)).foregroundStyle(PC.sky)
            Text("© qramo, © リョータ").font(.system(size: 14, weight: .semibold)).foregroundStyle(PC.text)
            Text("このアプリは、qramo さんの「ぽっと通話」をもとに、ボタンを押している間だけ話せるようにしたものです。").font(.system(size: 13)).foregroundStyle(PC.text)
            Link("potalk.app", destination: URL(string: "https://potalk.app/")!)
            Link("github.com/qramo/po_call", destination: URL(string: "https://github.com/qramo/po_call")!)
            Text("このアプリのソースコードは GitHub で公開しています。").font(.system(size: 13)).foregroundStyle(PC.text)
            Link("github.com/riryo3/pochittalk", destination: URL(string: "https://github.com/riryo3/pochittalk")!)
            Text(mitText).font(.system(size: 11)).foregroundStyle(PC.muted)
            Text("使っているオープンソース").font(.system(size: 14, weight: .bold)).foregroundStyle(PC.text).padding(.top, 6)
            Text("• WebRTC（Google, BSD-3-Clause。stasel/WebRTC のビルドを使用）\n• swift-secp256k1（21-DOT-DEV, MIT。Nostr の署名に使用）\n• Trystero（Dan Motz, MIT。通信の手順を Swift に移したもの）")
                .font(.system(size: 12)).foregroundStyle(PC.muted)
        }
    }
}
