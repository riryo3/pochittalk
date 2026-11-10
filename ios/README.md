# ぽちっと通話 iPhone 版 (Swift / SwiftUI)

ボタンを押している間だけ話せる、トランシーバー風のグループ通話アプリの iPhone ネイティブ版（α）。
Web 版・Android 版と**同じ部屋で相互に通話**できます。ロック画面・バックグラウンドでも **VOX（声で自動送信）** が使えるように作っています（※実機での確認はこれから。下の「検証状況」を読んでください）。

- アプリ名: ぽちっと通話 / バンドル ID: `app.pochitalk.ios`（仮）/ 対応: iOS 16 以上、iPhone（縦向き）と iPad（広い画面では 2 列）
- 元になった作品: qramo さんの「ぽっと通話」（[potalk.app](https://potalk.app/) / [github.com/qramo/po_call](https://github.com/qramo/po_call)、MIT）
- 著作: © qramo, © リョータ（MIT ライセンス。リポジトリ直下の `LICENSE`）

## ビルド

必要なもの: Xcode 26 以降（Xcode 27.1 で確認）。ネットワーク（初回に Swift パッケージを取得）。

```bash
cd ios
open Pochitalk.xcodeproj
```

Xcode で、スキーム `Pochitalk`、行き先に iPhone のシミュレーターを選んで ▶︎ で動きます。
コマンドラインなら:

```bash
cd ios
xcodebuild -project Pochitalk.xcodeproj -scheme Pochitalk -destination 'platform=iOS Simulator,name=iPhone 17' build CODE_SIGNING_ALLOWED=NO
xcodebuild test  -project Pochitalk.xcodeproj -scheme Pochitalk -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
```

- 依存（Swift Package Manager。どちらも固定バージョン）
  - [stasel/WebRTC](https://github.com/stasel/WebRTC) 157.0.0（Google WebRTC の iOS ビルド）
  - [21-DOT-DEV/swift-secp256k1](https://github.com/21-DOT-DEV/swift-secp256k1) 0.24.0（Nostr の Schnorr 署名）
- `Pochitalk.xcodeproj` は `tools/generate_xcodeproj.py` で作っています。**ファイルを足したら** `cd ios && python3 tools/generate_xcodeproj.py` をもう一度実行してください（Xcode 上で足したファイルは、次回の生成で消えます）。
- 秘密（TURN の鍵など）は、コードにも設定にも入っていません。TURN の資格情報は、起動時に `https://pochittalk.ryota-softwares.workers.dev/api/turn` から短命のものを受け取ります。

## 実機に入れる（署名）

Apple Developer Program への登録は必須ではありません。**無料の Apple ID でも、自分の iPhone に入れて試せます**（ただし、入れたアプリは 7 日で期限切れになり、そのたびに Xcode から入れ直し。同時に 3 本まで）。TestFlight / App Store には、有料の登録（年 12,800 円）が必要です。

1. iPhone を Mac に USB でつなぎ、iPhone 側で「このコンピュータを信頼」。
2. iPhone の **設定 → プライバシーとセキュリティ → デベロッパモード** をオンにして、再起動（出てこないときは、一度 Xcode で iPhone を選んで Run すると出ます）。
3. Xcode で `ios/Pochitalk.xcodeproj` を開く → 左のナビで一番上の「Pochitalk」→ ターゲット **Pochitalk** → **Signing & Capabilities**。
   - **Automatically manage signing** にチェック。
   - **Team**: 「Add an Account…」で自分の Apple ID を足し、**(Personal Team)** を選ぶ。
   - **Bundle Identifier**: `app.pochitalk.ios` は他の人が使っていて通らないことがあります。通らなければ、`com.（自分の名前）.pochitalk` のように、世界で一つの名前に変える（実機に入れるだけなら、何でもよい）。
4. Xcode 上部の行き先で、つないだ iPhone を選び、▶︎ で Run。
5. 初回だけ、iPhone の **設定 → 一般 → VPN とデバイス管理** で、自分の Apple ID の開発者を「信頼」。もう一度 Run。
6. アプリを開き、マイクの許可で「許可」。

## 実機での確認手順（ここが、まだ確認できていないところ）

目的: **ロック中・バックグラウンドで VOX が動くこと**、割り込みから戻れること。
用意するもの: iPhone と、相手役（おうむ返しボットの部屋 `7A0B·07C1` が簡単。話した声が、そのまま返ってきます）。**イヤホン推奨**（スピーカーの音をマイクが拾って、VOX が自分の声と間違えるため）。

### A. 基本（画面を点けたまま）

1. アプリを開き、一覧の「🦜 7A0B·07C1」（赤い線に合っているはず）をタップして入る。
2. 参加者に「おうむ返しボット」が出る（数秒〜）。出なければ「再接続」。
3. 話すボタンを押して「あー」と言って離す → ボットが同じ声を返す（RX 表示と、声）。
4. VOX ボタンをオンにして、話しかける（ボタンは押さない）→ 自動で TX になり、声が返ってくる。反応が悪ければ「しきい値」を下げる（左へ）。入りすぎるなら上げる。

### B. ロック中の VOX（最重要）

1. 上の 4 まで済ませ、**VOX がオン**の状態にする（緑の ON）。
2. iPhone の**サイドボタンを 1 回押して、画面を消す**（ロック）。画面右上のオレンジ色のマイクの点が出ていれば、マイクは動いています。
3. 話しかける → ボットが声を返す（イヤホンなら、イヤホンから聞こえる）。→ **聞こえたら成功**。
4. そのまま 5 分、10 分、30 分と置いてから、同じことをする（途中で止まっていないか）。
5. ホーム画面に戻って別のアプリ（Safari など）を開いた状態でも、同じことをする。
6. 戻ったとき、画面に「STANDBY」と相手の一覧が出ていること（出ていなければ、記録を取る → 下）。

### C. 割り込みと経路

1. VOX オン・ロック中に、別の iPhone / 家族から**電話をかけてもらう**（出ても、断ってもよい）。終わったあと、ロックを解除せずに、もう一度 B の 3。戻らなければ、ロックを解除してアプリを開く（開くと復帰を試みます）。→ どちらで戻ったかを記録。
2. AirPods などの Bluetooth を、通話中につなぐ/外す → 音の行き先が変わっても、声が出る・拾える。
3. Wi-Fi ↔ モバイルを切り替える → しばらくして、つなぎ直されるか（「再接続」でも可）。

### D. うまくいかないとき、記録を取る

- アプリの ホーム画面 → ⚙ 設定 → いちばん下の「診断」→「接続の記録を表示」: 音声ユニットの起動/停止（`started` / `interrupted` / `stopped`）、相手とつながった時刻、送信開始/終了の時刻が出ます。ロック中に動いていたかを、時刻で見分けられます。
- もっと詳しくは、Mac の Xcode で iPhone をつないだまま、**Window → Devices and Simulators → Open Console**、または Console.app で、`subsystem:app.pochitalk` を絞り込む。

## 作りの要点

| 場所 | 役割 |
| --- | --- |
| `Pochitalk/Core/` | Trystero 0.25.4 (Nostr) の通信の移植: `TrysteroCrypto`（トピック・AES-GCM）、`ActionCodec`（データチャネルの枠）、`NostrProtocol` / `NostrClient`（署名つきイベントと WebSocket） |
| `Pochitalk/RTC/` | `RtcPeer`（WebRTC の接続。Perfect Negotiation）、`TrysteroRoom`（相手探し・オファー/アンサー・ハンドシェイク）、`TrysteroNetwork`、`Lobby`（部屋一覧の在室通知・リレー選び・TURN 取得） |
| `Pochitalk/Engine/PochiEngine.swift` | 画面の状態と動き（入退室・話す・VOX・混線・再接続・8 人上限）。Android 版 `PochiEngine.kt` の移植 |
| `Pochitalk/Engine/PochiAudioDevice.swift` | **ロック中 VOX の中心**。マイクとスピーカーを 1 つの VoiceProcessingIO（エコー消し）に集約する、WebRTC 用のカスタム音声デバイス |
| `Pochitalk/UI/` | SwiftUI の画面。`RoomDial`（円柱が回る部屋ダイヤル、赤い線）、`RadioScreen`、`QrBackFace`、設定、このアプリについて |

### ロック中 VOX のしくみ

- `Info.plist` の `UIBackgroundModes` に `audio`。
- 部屋に入っている間は、`AVAudioSession` を `.playAndRecord` / `.voiceChat` で**有効にしたまま手放さず**、音声ユニットを**動かし続ける**（`PochiAudioDevice.keepRunning`）。送信していない間も、マイクの音量を測って VOX を判定する。ボタンを押した（VOX が声を検出した）瞬間に、マイクの起動待ち無しで送れる。
- 送信するのは、押している間 / VOX 検出中だけ。そうでないときは、WebRTC に音を渡さない（何も流れない）。
- 割り込み（電話・Siri）で止まったら、終わったときに自動で立て直す（失敗したら 1 秒ごとに最大 30 回）。経路変更（イヤホン等）でサンプルレートが変わったらユニットを作り直す。メディアサービスのリセットにも対応。
- 部屋を出る（退出）と、音声セッションを手放す。

## 検証状況（正直な記録）

### 確認したこと（シミュレーター: iPhone 17 / iOS 27.0、実際の通信）
- ビルド: シミュレーター向け Debug、実機向け (`generic/platform=iOS`) Release の両方が成功（署名なし）。
- 単体テスト 15 件が成功: Trystero 0.25.4 の**本物の暗号文の復号**、トピック・kind・部屋トークン・フレームのバイト列（Android 版と同じ期待値）、Nostr イベントの id と Schnorr 署名の検証、PTT ジェスチャー、招待 URL の読み取り、TURN 応答の解析。
- ウェブ版のおうむ返しボット（本番の Web ページ）の部屋に入り、**Nostr のシグナリング → WebRTC → データチャネル → 在室確認**が通り、参加者に「おうむ返しボット」が出た。
- **話す → ボットが返す**: こちらの送信（音声）がボットに届き、ボットの `pttState`（話し始め/終わり）と、受信音声のレベル（RX メーター）が返ってきた。つまり、**双方向**で届いている。
- 部屋一覧（在室通知）をリレーから受け取り、おうむ返しの部屋を先頭に、赤い線に合わせて表示。入室すると、その部屋が赤い線に来る。
- VOX: オンにでき、しきい値を超えると自動で TX になり、声が止まると（1.5 秒）終わる。しきい値のスライダー、話し中の相手がいるときは割り込まない。
- 入力レベル（ゲイン）、スピーカーのミュート、QR 招待（本物の QR コード）、設定画面、このアプリについて（プライバシー・ライセンス・クレジット）。
- アプリを裏に回す（ホームボタン）と、プロセスは生き続け、リレーと WebRTC のデータ通信が動き続けた（裏にいる間に、ボットの「話し終わり」の通知が届いたことを、通信の記録の時刻で確認）。ただし、裏でマイクが動き続けていたか（VOX の判定が続いていたか）は、シミュレーターのマイクが無音だったため、確認できていません。
- TURN: `/api/turn` から資格情報を取得（HTTP 201 を成功として扱う）。

### まだ確認していないこと
- **実機でのロック中の動作（最重要）**。シミュレーターには「ロック」がなく、マイクも Mac のものです。このときのシミュレーターのマイクは無音（−95 dB）で、Mac の `say` の声を拾えなかったため、「裏で、声から VOX が始まる」ことは確かめられていません。上の手順書 B で確認してください。
- 割り込み（電話）からの復帰、Bluetooth の抜き差し、メディアサービスのリセット。コードはありますが、実機で動かしていません。
- 実機でのエコー（スピーカーの音をマイクが拾う）の程度、VOX のしきい値の目安（Android 版の値をそのまま使っています。端末ごとに調整が必要かもしれません）。
- 効果音（ピッ・ガッ等）の音色（耳での確認）。
- 複数人（3 人以上）の部屋、Android 版との通話、Web 版のブラウザ（ボット以外の人間）との通話。
- 長時間（数十分以上）の連続動作、バッテリーの消費。
- TestFlight / App Store 向けのアーカイブ、有料の署名。

### 既知の注意
- リレーは、Web 版・Android 版と同じく、動いているものから**ランダムに 3 本**選びます。そのため、相手と選んだリレーが重ならないことが（約 1 割）あります。その場合は、10〜25 秒後に自動でつなぎ直します（「再接続」でも可）。実際、シミュレーターでも 1 回、つながるまで時間がかかりました。
- 招待のリンクを開いたときの自動入室は、Web 版の `?r=` と、`pochitalk://…?r=` のカスタム URL に対応しています。https のリンクをタップしたらアプリが開く（Universal Links）は、Web 側に `apple-app-site-association` を置く必要があり、未対応です。
- Bluetooth の HFP（通話用の低音質）に切り替わると、サンプルレートが下がります。ユニットを作り直しますが、実機では未確認です。

## モールス・FAX の受信

- 受信した音 (再生側) を 15ms ごとに測り (`ToneMeter`: ゴルツェル法)、700Hz の純音の長短をモールスの文字に戻して液晶に出す (`MorseDecoder`、Web 版の復号と同じ手順)。
- FAX は、データ便 `faxPage` で届く絵を、音のピー (1500Hz) に合わせて 1 行ずつ紙に出す (`FaxReceiver`)。ピーが聞こえなくても 1.5 秒後に始める。「ESC」を受けると紙を隠す。
- 検証済み: 合成した 700Hz のモールス ("SOS", "CQ 73") の復号と、faxPage の読み取りの単体テスト。
- 未検証: 実機で Web 版からの実際のモールス/FAX を受けたときの読み取り精度 (Opus 圧縮・回線の揺れ)、音で届く FAX の画素そのものの復号 (紙の中身はデータ便の絵を使う)。
- 送信は未対応 (受信のみ)。
