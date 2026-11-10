package app.pochitalk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.clickable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.PttPosition
import app.pochitalk.engine.UiState

private val LinkStyle = TextLinkStyles(SpanStyle(color = Color(0xFF93C5FD), textDecoration = TextDecoration.Underline))

private fun linkText(label: String, url: String) = buildAnnotatedString {
    withLink(LinkAnnotation.Url(url, LinkStyle)) { append(label) }
}

/** 設定: マイク (入力レベル・マイクテスト) / 初回案内 / ソース・ライセンス / このアプリについて。Web版の設定ダイアログに対応。 */
@Composable
fun SettingsDialog(state: UiState, actions: Actions, onShowAbout: () -> Unit, onDismiss: () -> Unit) {
    // 設定を閉じたら、マイクテストを止める (Web版と同じ)
    DisposableEffect(Unit) {
        onDispose { PochiEngine.setMicTest(false) }
    }
    val meter by PochiEngine.meter.collectAsStateWithLifecycle()
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .heightIn(max = 640.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(PochiColors.Card)
                .border(2.dp, PochiColors.Border, RoundedCornerShape(20.dp)),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("設定", color = PochiColors.Text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                SubButton(onClick = onDismiss, small = true) { Text("閉じる") }
            }
            HorizontalDivider(color = PochiColors.Border)
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SectionTitle("マイク")
                Text(
                    "「マイクテスト開始」を押して声を出し、メーターが振れることを確認してください。小さく聞こえる場合は、入力レベルを上げます（上げすぎると音が割れます）。",
                    color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp,
                )
                InputLevelSetting(state)
                LevelMeter(if (state.micTest) meter else meter.copy(label = "MIC", level = 0f, peak = 0f, dbText = "-∞ dB"))
                SubButton(
                    onClick = { actions.micTest(!state.micTest) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (state.micTest) "マイクテスト停止" else "マイクテスト開始") }

                SectionTitle("操作")
                Text("話すボタンの位置", color = PochiColors.Text, fontSize = 13.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(PttPosition.LEFT to "左", PttPosition.CENTER to "中央", PttPosition.RIGHT to "右").forEach { (pos, label) ->
                        SubButton(
                            onClick = { PochiEngine.setPttPosition(pos) },
                            modifier = Modifier.weight(1f),
                            container = if (state.pttPos == pos) PochiColors.Accent else Color(0xFF374151),
                        ) { Text(label, fontWeight = if (state.pttPos == pos) FontWeight.Bold else FontWeight.Normal) }
                    }
                }
                Text("VOX のボタンは、話すボタンの空いている側に付きます。", color = PochiColors.Muted, fontSize = 12.sp)
                SwitchRow("左手用（話すボタンが中央のとき、VOX ボタンを右側に置く）", state.lefty) { PochiEngine.setLefty(it) }

                SectionTitle("効果音")
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("音量", color = PochiColors.Text, fontSize = 13.sp)
                    Text("${state.sfxVolume}%", color = PochiColors.Sky, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                }
                Slider(
                    value = state.sfxVolume.toFloat(),
                    onValueChange = { PochiEngine.setSfxVolume(((it / 5).toInt()) * 5) },
                    onValueChangeFinished = { PochiEngine.previewSfx() },
                    valueRange = 0f..150f,
                    steps = 29,
                )
                Text("スライダーを離すと、試しに「ガッ」と鳴ります。効果音を消したいときは、音量を 0% にしてください。", color = PochiColors.Muted, fontSize = 12.sp)

                SwitchRow("新しい部屋ができたら、音で知らせる", state.notifyRoom) { PochiEngine.setNotifyRoom(it) }
                Text("音だけです（画面の知らせや、通知は出しません）。効果音の音量が 0% のときは鳴りません。", color = PochiColors.Muted, fontSize = 12.sp)

                SectionTitle("通信の記録")
                SwitchRow("通信の記録を、この端末に残す", state.logMode) { PochiEngine.setLogMode(it) }
                Text("標準では、通信の記録を端末に保存しません。オンにすると、最大 300 行を、この端末だけに保存します（外部へは送りません）。オフにすると消えます。オンの間は、名前の前に 💾 が付き、同じ部屋の人にもその名前で見えます。", color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp)

                SectionTitle("再接続")
                SwitchRow("自動で再接続する", state.autoReconnect) { PochiEngine.setAutoReconnect(it) }
                Text("オフのときは、人数のずれ・回線の復帰・画面に戻ったときに、自動ではつなぎ直しません。つながらないときは、「再接続」を押してください。", color = PochiColors.Muted, fontSize = 12.sp)

                SectionTitle("初回案内")
                SwitchRow("開いたときに初回案内を表示する", state.welcomeOn) { PochiEngine.setWelcomeOn(it) }

                SectionTitle("ソース・ライセンス")
                Text("このアプリは、qramo さんの「ぽっと通話」をもとに、ボタンを押している間だけ話せるようにしたものです。", color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp)
                Text(linkText("potalk.app", "https://potalk.app/"), fontSize = 13.sp)
                Text(linkText("github.com/qramo/po_call", "https://github.com/qramo/po_call"), fontSize = 13.sp)
                Text("このアプリのソースコードは GitHub で公開しています。", color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp)
                Text(linkText("github.com/riryo3/pochittalk", "https://github.com/riryo3/pochittalk"), fontSize = 13.sp)
                Text("MIT License\nCopyright (c) 2026 qramo\nCopyright (c) 2026 リョータ", color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp)
                Text(
                    buildAnnotatedString {
                        append("使用ライブラリ: ")
                        withLink(LinkAnnotation.Url("https://github.com/dmotz/trystero", LinkStyle)) { append("Trystero") }
                        append("（MIT License。通信方式を Kotlin に移植）、")
                        withLink(LinkAnnotation.Url("https://github.com/GetStream/webrtc-android", LinkStyle)) { append("stream-webrtc-android") }
                        append("（Apache License 2.0）、")
                        withLink(LinkAnnotation.Url("https://github.com/square/okhttp", LinkStyle)) { append("OkHttp") }
                        append("（Apache License 2.0）")
                    },
                    color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp,
                )

                SectionTitle("このアプリについて")
                SubButton(onClick = onShowAbout, modifier = Modifier.fillMaxWidth(), container = Color(0xFF1E293B)) { Text("使い方・プライバシーを見る") }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, color = Color(0xFF93C5FD), fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(top = 8.dp))
    HorizontalDivider(color = PochiColors.Border)
}

/** 初回案内。起動時に出す (設定でオフにできる)。 */
@Composable
fun WelcomeDialog(state: UiState, onSettings: () -> Unit, onAbout: () -> Unit, onClose: () -> Unit) {
    // 同意するまでは、戻る操作や外側のタップでは閉じられない
    Dialog(onDismissRequest = { if (state.consentOk) onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .heightIn(max = 640.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(PochiColors.Card)
                .border(2.dp, PochiColors.Border, RoundedCornerShape(20.dp))
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("ようこそ", color = PochiColors.Text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    "α版",
                    color = PochiColors.Amber, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier
                        .border(1.dp, PochiColors.Amber, RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
            Text("はじめにご確認ください。", color = PochiColors.Text, fontSize = 13.sp)
            SectionTitle("1. マイクを設定する")
            Text("声が相手に十分な大きさで届くよう、入力レベルを調整できます。", color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp)
            SubButton(onClick = onSettings, modifier = Modifier.fillMaxWidth(), container = Color(0xFF1E293B)) { Text("マイクを設定する") }
            SectionTitle("2. このアプリについて読む")
            Text("使い方と、プライバシー（見える情報、保存されるもの）を説明しています。", color = PochiColors.Text, fontSize = 13.sp, lineHeight = 20.sp)
            SubButton(onClick = onAbout, modifier = Modifier.fillMaxWidth(), container = Color(0xFF1E293B)) { Text("このアプリについて") }
            SwitchRow("次回も表示する", state.welcomeOn) { PochiEngine.setWelcomeOn(it) }
            var agreed by remember { mutableStateOf(state.consentOk) }
            if (!state.consentOk) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.clickable { agreed = !agreed }) {
                    androidx.compose.material3.Checkbox(checked = agreed, onCheckedChange = { agreed = it })
                    Text(
                        "「このアプリについて」を読み、次のことを了解しました。個人が作ったα版で、動作や安全性の保証はありません。部屋は公開で、知らない人にも声が聞こえます。人数が多いと、つながりにくくなることがあります。自己責任で使います。",
                        color = PochiColors.Text, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            SubButton(
                onClick = { if (!state.consentOk) PochiEngine.acceptConsent(); onClose() },
                enabled = agreed,
                modifier = Modifier.fillMaxWidth(),
                container = Color(0xFF2563EB),
            ) { Text("はじめる") }
        }
    }
}
