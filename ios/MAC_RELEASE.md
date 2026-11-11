# Mac 版 (ぽちっと通話) の配布手順 (α版 / GitHub Releases)

## 構成
- 同じ `Pochitalk.xcodeproj` の `PochitalkMac` ターゲット (`ios/tools/generate_xcodeproj.py` が作る)。通信・部屋・在室通知・ダイヤル・モールス/FAX は iOS 版と同じソースを共有。
- Mac 専用: `PochitalkMac/` (Info.plist / entitlements / アイコン / WebRTC の `RTCAudioDevice` 宣言のブリッジヘッダ)。
- 対象: macOS 14 以降、Apple Silicon / Intel 両対応 (universal)。
- bundle id は iOS と同じ (今は `app.ryota.pochitalk`)、チームも同じ。

## ビルド (開発用)
```bash
cd ios && python3 tools/generate_xcodeproj.py
xcodebuild -project Pochitalk.xcodeproj -scheme PochitalkMac -destination 'platform=macOS' build
```

## 署名と公証 (配布用)  ※ 必要なもの
1. **Developer ID Application 証明書** … この Mac には「Apple Development」しかない (2026-11-11 時点)。Apple Developer Program (有料) の Certificates, Identifiers & Profiles → 「Developer ID Application」を作って、キーチェーンに入れる。
2. **公証用の資格情報** … App Store Connect の API キー、または Apple ID + アプリ用パスワード (+ チーム ID `R299H66ZH3`)。
   ```bash
   xcrun notarytool store-credentials pochi-notary --apple-id <Apple ID> --team-id R299H66ZH3 --password <アプリ用パスワード>
   ```

## 手順
```bash
cd ios
# 1. アーカイブ (Release / Hardened Runtime / サンドボックス有効)
xcodebuild -project Pochitalk.xcodeproj -scheme PochitalkMac -configuration Release \
  -destination 'generic/platform=macOS' -archivePath build/Pochitalk.xcarchive archive
# 2. Developer ID で書き出し (ExportOptions.plist: method=developer-id, teamID=R299H66ZH3)
xcodebuild -exportArchive -archivePath build/Pochitalk.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export
# 3. zip にして公証 → ホチキス留め
ditto -c -k --keepParent build/export/Pochitalk.app build/Pochitalk-mac.zip
xcrun notarytool submit build/Pochitalk-mac.zip --keychain-profile pochi-notary --wait
xcrun stapler staple build/export/Pochitalk.app
# 4. 配る形にする (どちらか)
ditto -c -k --keepParent build/export/Pochitalk.app Pochitalk-mac-0.1.0-alpha.zip
hdiutil create -volname "ぽちっと通話" -srcfolder build/export/Pochitalk.app -ov -format UDZO Pochitalk-mac-0.1.0-alpha.dmg
# 5. 確認
spctl -a -vvv -t install build/export/Pochitalk.app
```
`ExportOptions.plist` の例:
```xml
<dict><key>method</key><string>developer-id</string><key>teamID</key><string>R299H66ZH3</string><key>signingStyle</key><string>automatic</string></dict>
```
公証なしの zip を配ると、受け取った人の Mac で「開発元を確認できません」と出る (右クリック→開く で開けるが、案内が要る)。

## 未確認・注意
- 証明書がないので、署名・公証・dmg は、まだ試していない (開発用署名でのビルドと起動までは確認済み)。
- Mac 版 WebRTC には `RTCAudioDevice` の宣言が入っていないため、iOS/Catalyst 版のヘッダを `PochitalkMac/RTCAudioDevice.h` に写している。stasel/WebRTC を上げるときは、この動作 (起動・受信・送信) を確かめ直すこと。
- Mac には音声セッションがないので、割り込み・経路変更の自動復旧は入れていない (既定のマイク/スピーカーを使う)。
