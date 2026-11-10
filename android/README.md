# ぽちっと通話 Android版 (Kotlin / ネイティブ) — α 0.5.0

Web版 (`../worker.js`) と**同じ部屋で相互に通話できる**ネイティブアプリです。
Web版が使っている [Trystero](https://github.com/dmotz/trystero) **0.25.4** の nostr 方式を Kotlin で再実装しています。

> **0.4.0-alpha は通信形式が変わりました。** 旧Android版 (0.3.0 以前) や旧Web版 (Trystero 0.20.0) とは、お互いに見えず、通話もできません
> (識別名 `pochitalk-v2` が別で、通信の形式も違うため)。Web版も 0.25.4 の版 (`/version` が `trystero: 0.25.4`) が必要です。

## ビルド

```bash
./gradlew :app:testDebugUnitTest   # 署名・暗号・フレーミングの単体テスト (本物の Trystero 0.25.4 の出力と照合)
./gradlew :app:assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

JDK 17、Android SDK 35。通信のログは `adb logcat -s Pochitalk` で見られます。

### 設定したい場所

| 何を | どこを |
|---|---|
| 招待URL・TURN 資格情報の取得先 (Web版の公開URL) | `engine/PochiEngine.kt` の `INVITE_BASE_URL` と、`AndroidManifest.xml` の `android:host` |
| Nostr リレー (**Web版の `NOSTR_RELAY_URLS` と同じ7本**) | `rtc/Lobby.kt` の `RelayList.NOSTR_RELAY_URLS` |
| 「このアプリについて」の本文 | `ui/AboutContent.kt` (保存・送信するデータを変えたら必ず更新) |

## Web版との互換性を決めている定数 (変えると通話できなくなる)

- appId `pochitalk-v2`、通話部屋 `h-<8桁の16進ハッシュ>`、1部屋8人まで
- アクション名: `pttState` `{isTalking}` / `pttName` 文字列 / `joinAge` `{age}` / `roomTag` `{tag, by, at}`。`faxPage` `{c, d}` (FAX の中身: 幅と、14行ぶん・1画素1ビットの base64) は受け取って紙に出す。それ以外の知らない名前は組み立てずに捨てる
- 部屋一覧は WebRTC ではなく Nostr の在室通知: kind 29334 / タグ `x` = `pochitalk-presence-v1` / content `{ch, talking, name, tag, by, at}`、6秒おき、20秒で失効
- 招待URLは `?r=<ハッシュ>` (Web版と同じ)。ネイティブ側は `pochitalk://join?r=<ハッシュ>` も受け付けます

## 構成

```
app/src/main/java/app/pochitalk/
├─ core/      純Kotlin (JVMで単体テスト可能)
│   ├─ Schnorr.kt          BIP340 署名 (Nostrのイベント署名)。外部ライブラリ無し
│   ├─ NostrProtocol.kt    イベント (kind は topic ごと: strToNum(topic,1e4)+2e4) と購読 (複数 topic を1本にまとめる)
│   ├─ NostrClient.kt      リレーとのWebSocket、再接続と購読の再送
│   ├─ TrysteroCrypto.kt   topic = SHA-1 を1バイトずつ base36、AES-GCM、部屋トークン (deriveRoomNamespace)
│   └─ ActionCodec.kt      アクションのフレーム (名前32バイト+nonce2バイト+tag+progress) と、部屋トークン付きフレーム
├─ rtc/       Trystero 0.25.4 の移植 (libwebrtc を使う)
│   ├─ RtcPeer.kt          peer.ts: ICE 候補を少しずつ送る (trickle)、Perfect Negotiation、切断の検知
│   ├─ TrysteroRoom.kt     相手探し (announce / offer / answer / candidate)、接続後の確認 (@_hsready)、アクション
│   ├─ TrysteroNetwork.kt  リレー接続の共有、購読の振り分け、selfId
│   ├─ Lobby.kt            在室通知 (部屋一覧)、リレーの選別 (動いているものを全部)、TURN 資格情報の取得
│   └─ Runtime.kt          通信は全部この単一スレッドで処理 (JSの前提を保つため)
├─ engine/    アプリのふるまい (PochiEngine: 入退室、PTT、話中ロック、混線、VOX、満員、つながり不一致の監視)
├─ audio/     効果音、マイクの増幅/ミュート、待機中のマイク監視
├─ service/   通話を続けるフォアグラウンドサービス (microphone)
└─ ui/        Compose の画面
```

### 通信の流れ (Web版と同じ)

1. 部屋ごとの **rootTopic** (`sha1("Trystero@appId@roomId")`) と自分宛の **selfTopic** を、動いているリレー (全部) に購読する。
2. rootTopic に `{"peerId": selfId}` を投稿 (announce): 0.23秒・0.5秒・1.3秒のあとは60秒おき。相手が消えたときも最初からやり直す。
3. announce を見たら、**selfId が小さい側**がオファーを作り、相手の selfTopic へ送る。大きい側は自分の announce を返して待つ。
   オファー/アンサー/候補は AES-GCM で暗号化した文字列 `{peerId, offerId, offer|answer|candidate}`。候補は少しずつ送る。
4. データチャネルが開いたら、部屋トークン付きのフレームで在室を知らせ、`@_hsready` を送り合って、両方そろったら入室扱い。
   接続後の SDP と候補は `@_signal` で送る。音声は `@_stream` のメタ情報 `{k, s}` を先に送ってからトラックを足す (ブラウザ側が再生に使う)。
5. TURN は端末に鍵を持たず、Web版の `/api/turn` から短命の資格情報を受け取る (直接つなぐのを優先し、だめなときだけ中継)。

**Android の selfId は先頭が `00`** です (`TrysteroNetwork.SELF_ID`)。Android が必ずオファー側になるようにするための工夫で、
Web版 (0.25.4) が作り置きから出すオファーは、57秒以上たつとブラウザの挙動で中身の無い SDP になり、
ブラウザがオファー側のときにつながらないことがあるため (`m=` 行が無いオファーは、受け取っても無視して announce をやり直します)。

## 検証状況 (0.4.0-alpha)

実機 (Pixel 3a / Galaxy SCV38) と、公開中の Web版 (0.25.4)・おうむ返しボット (`/bot`、部屋 `7a0b07c1`) で確認:

- 単体テスト: 署名・topic・kind・部屋トークン・暗号文の復号・アクションのフレーム・部屋フレームが、本物の Trystero 0.25.4 のコードの出力と一致
- 部屋一覧 (Nostr の在室通知) の受信、入室、ブラウザ↔Android の相互の名前表示
- Android→ブラウザの音声 (RX 点灯とレベル)、ブラウザ→Android の音声 (RX 0 dB)
- ブラウザから送ったモールス (SOS) の文字起こしと、FAX (HELLO) の紙の表示 (Galaxy 実機)
- Android 同士 + ブラウザの3者の相互接続、オファー側/アンサー側の両方
- つながり不一致の通知と自動つなぎ直し (25秒)

未確認: TURN 中継だけで通すとき (中継候補の収集までは確認)、9人目の満員の挙動、長時間の通話、おうむ返しボットからの返事の再生。
