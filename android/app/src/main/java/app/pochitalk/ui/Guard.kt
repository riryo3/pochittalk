package app.pochitalk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pochitalk.engine.PeerInfo
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.UiState
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val REPORT_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSe6jY8RmSERemjRLPO2YFQP1-sORD_6fgQKL4d6osGMuEmFTA/viewform"
private val GuardBg = Color(0xFF3B2418)
private val GuardFg = Color(0xFFFDBA74)

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

private fun reportUrl(name: String, uid: String, room: String, time: String) =
    REPORT_FORM + "?usp=pp_url&entry.1506782741=" + enc(name) + "&entry.19877550=" + enc(uid) + "&entry.863421843=" + enc(room) + "&entry.129880049=" + enc(time)

/** 部屋の中で、相手の名前をタップしたときのメニュー (ミュートに登録／解除、通報)。 */
@Composable
fun GuardMenuDialog(state: UiState, peer: PeerInfo, roomKey: String, onClose: () -> Unit) {
    var report by remember { mutableStateOf(false) }
    val registered = peer.uid.isNotEmpty() && state.guardIds.containsKey(peer.uid)
    val uriHandler = LocalUriHandler.current
    if (!report) {
        AlertDialog(
            onDismissRequest = onClose,
            title = { Text(peer.name, fontSize = 16.sp) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (peer.uid.isEmpty()) Text("この相手は、目印（ID）を送ってこない古い版のため、ミュートの登録はできません。", fontSize = 13.sp, lineHeight = 19.sp)
                    else Text("ミュートに登録すると、この相手の声は聞こえなくなります（この端末だけの設定です。相手には伝わりません）。", fontSize = 13.sp, lineHeight = 19.sp)
                    if (peer.uid.isNotEmpty()) {
                        TextButton(onClick = { PochiEngine.toggleGuardMute(peer.id); onClose() }, modifier = Modifier.fillMaxWidth()) {
                            Text(if (registered) "ミュートを解除する（リストから外す）" else "ミュートに登録する")
                        }
                    }
                    TextButton(onClick = { report = true }, modifier = Modifier.fillMaxWidth()) { Text("この相手を通報する") }
                }
            },
            confirmButton = { TextButton(onClick = onClose) { Text("閉じる") } },
        )
        return
    }
    var muteAlso by remember { mutableStateOf(peer.uid.isNotEmpty() && !registered) }
    var wordAlso by remember { mutableStateOf(false) }
    val time = remember { SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()) }
    val nm = peer.name
    val uidText = peer.uid.ifEmpty { "（不明）" }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("この相手を通報する", fontSize = 16.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("次の内容が、通報フォームに入った状態で開きます（あなたの情報は入りません）。", fontSize = 13.sp, lineHeight = 19.sp)
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color(0xFF0F172A)).border(1.dp, Color(0xFF334155), RoundedCornerShape(8.dp)).padding(8.dp),
                ) {
                    Text("名前: $nm\nID: $uidText\n部屋: $roomKey\n時刻: $time", fontSize = 12.sp, lineHeight = 18.sp, fontFamily = FontFamily.Monospace)
                }
                if (peer.uid.isNotEmpty() && !registered) {
                    Row(Modifier.clickable { muteAlso = !muteAlso }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = muteAlso, onCheckedChange = { muteAlso = it })
                        Text("この相手を、ミュートにも登録する", fontSize = 13.sp)
                    }
                }
                Row(Modifier.clickable { wordAlso = !wordAlso }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = wordAlso, onCheckedChange = { wordAlso = it })
                    Text("この名前を、嫌な言葉にも登録する", fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                PochiEngine.guardReportRegister(peer.id, muteAlso, wordAlso)
                runCatching { uriHandler.openUri(reportUrl(nm, uidText, roomKey, time)) }
                onClose()
            }) { Text("フォームを開く") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("やめる") } },
    )
}

/** 設定の「自衛リスト」の節: 嫌な言葉 → ミュートする相手 → 一致した部屋の扱い。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GuardSettings(state: UiState) {
    var word by remember { mutableStateOf("") }
    var delWord by remember { mutableStateOf<String?>(null) }
    var idText by remember { mutableStateOf("") }
    var idName by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    Text("この端末だけの設定です。相手には伝わりません。", color = PochiColors.Muted, fontSize = 12.sp)
    Text("① 嫌な言葉", color = PochiColors.Text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    Text("相手の名前や、部屋の話題タグに、この言葉が入っていたら、色を変えます（全角・半角、大文字・小文字、カタカナ・ひらがなは同じとみなします）。", color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = word, onValueChange = { word = it.take(20) }, singleLine = true,
            placeholder = { Text("言葉を入れて「追加」", fontSize = 12.sp) },
            modifier = Modifier.weight(1f),
        )
        SubButton(onClick = { if (PochiEngine.addGuardWord(word)) word = "" }, small = true) { Text("追加") }
    }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (state.guardWords.isEmpty()) Text("（まだ登録はありません）", color = PochiColors.Muted, fontSize = 12.sp)
        state.guardWords.forEach { w ->
            Text(
                w, color = GuardFg, fontSize = 13.sp,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(GuardBg).border(1.dp, Color(0xFF9A3412), RoundedCornerShape(999.dp))
                    .clickable { delWord = w }.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
    }
    delWord?.let { w ->
        AlertDialog(
            onDismissRequest = { delWord = null },
            text = { Text("「$w」を、嫌な言葉から外しますか？") },
            confirmButton = { TextButton(onClick = { PochiEngine.removeGuardWord(w); delWord = null }) { Text("外す") } },
            dismissButton = { TextButton(onClick = { delWord = null }) { Text("やめる") } },
        )
    }
    Text("② ミュートする相手", color = PochiColors.Text, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
    Text("登録した相手は、部屋に入ってきたら、声を自動で消音し、音と表示で知らせます。部屋の中で、相手の名前をタップしても登録できます。", color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp)
    if (state.guardIds.isEmpty()) Text("（まだ登録はありません）", color = PochiColors.Muted, fontSize = 12.sp)
    state.guardIds.forEach { (id, nm) ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$nm（$id）", color = PochiColors.Text, fontSize = 12.sp, modifier = Modifier.weight(1f))
            SubButton(onClick = { PochiEngine.removeGuardId(id) }, small = true) { Text("解除") }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = idText, onValueChange = { idText = it.take(16) }, singleLine = true,
            placeholder = { Text("目印（ID）", fontSize = 12.sp) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
            modifier = Modifier.weight(2f),
        )
        OutlinedTextField(
            value = idName, onValueChange = { idName = it.take(12) }, singleLine = true,
            placeholder = { Text("名前（メモ）", fontSize = 12.sp) },
            modifier = Modifier.weight(1.2f),
        )
    }
    SubButton(onClick = {
        err = PochiEngine.addGuardId(idText, idName)
        if (err == null) { idText = ""; idName = "" }
    }, modifier = Modifier.fillMaxWidth()) { Text("目印を追加") }
    err?.let { Text(it, color = Color(0xFFFCA5A5), fontSize = 12.sp) }
    if (state.myUid.isNotEmpty()) Text("この端末の目印: ${state.myUid}", color = PochiColors.Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
    Text("③ 一致した部屋の扱い", color = PochiColors.Text, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("warn" to "色を変える", "hide" to "一覧から隠す").forEach { (m, label) ->
            SubButton(
                onClick = { PochiEngine.setGuardMode(m) },
                modifier = Modifier.weight(1f),
                container = if (state.guardMode == m) PochiColors.Accent else Color(0xFF374151),
            ) { Text(label, fontWeight = if (state.guardMode == m) FontWeight.Bold else FontWeight.Normal) }
        }
    }
    Text("「色を変える」のときは、一致した部屋に入る前に確認を出します。「隠す」のときは、いま入っている部屋以外を、一覧から隠します。", color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp)
}

/** 設定の「相手の声の音量（ブースト）」。 */
@Composable
fun RxBoostSetting(state: UiState) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(1 to "そのまま", 2 to "2倍", 4 to "4倍").forEach { (v, label) ->
            SubButton(
                onClick = { PochiEngine.setRxBoost(v) },
                modifier = Modifier.weight(1f),
                container = if (state.rxBoost == v) PochiColors.Accent else Color(0xFF374151),
            ) { Text(label, fontWeight = if (state.rxBoost == v) FontWeight.Bold else FontWeight.Normal) }
        }
    }
    Text("相手の声が小さいときに上げます。上げすぎると音が割れたり、スピーカーマイクでハウリングしたりします。スピーカーのミュートと、自衛リストの消音は、これより優先されます（無音のままです）。", color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 18.sp)
}
