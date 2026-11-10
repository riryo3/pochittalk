package app.pochitalk.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.text.withLink
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import app.pochitalk.engine.MeterState
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.RoomInfo
import app.pochitalk.engine.UiState
import app.pochitalk.engine.formatKey

@Composable
fun PochiCard(
    modifier: Modifier = Modifier,
    background: Color = PochiColors.Card,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(background)
            .border(BorderStroke(2.dp, PochiColors.Border), RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("ぽちっと通話", color = Color(0xFF93C5FD), fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
        Text(
            "α版",
            color = PochiColors.Amber,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier
                .border(1.dp, PochiColors.Amber, RoundedCornerShape(6.dp))
                .padding(horizontal = 6.dp, vertical = 1.dp),
        )
    }
}

@Composable
fun Led(on: Boolean, color: Color) {
    Box(
        Modifier
            .size(12.dp)
            .clip(CircleShape)
            .background(if (on) color else PochiColors.LedOff),
    )
}

private class SearchFilter(val text: String, val hex: String?, val exact: String?)

/** 検索語から絞り込みの条件を作る (部屋のURL / ハッシュ / ニックネーム / 話題)。Web版の parseSearch と同じ。 */
private fun parseSearch(q: String): SearchFilter? {
    val s = q.trim()
    if (s.isEmpty()) return null
    val m = Regex("[?&]r=([0-9a-zA-Z]{8})(?![0-9a-zA-Z])").find(s)
    val hexq = s.lowercase().replace(Regex("[· -]"), "") // 区切り (· - 空白) を無視する
    val isHex = Regex("^[0-9a-z]{2,8}$").matches(hexq)
    val exact = m?.groupValues?.get(1)?.lowercase() ?: if (Regex("^[0-9a-z]{8}$").matches(hexq)) hexq else null
    return SearchFilter(s.lowercase(), if (isHex) hexq else null, exact)
}

private fun matchSearch(room: RoomInfo, f: SearchFilter): Boolean {
    if (f.exact != null) return room.key == f.exact
    if (f.hex != null && room.key.contains(f.hex)) return true
    if (room.tag.lowercase().contains(f.text)) return true
    return room.names.any { it.lowercase().contains(f.text) }
}

/** 「いまある部屋」の一覧。ホーム画面と無線機画面の両方に出す。検索・話題タグ付き。 */
@Composable
fun RoomListCard(state: UiState, onJoin: (String) -> Unit, showReconnect: Boolean = false, onCenter: (String?) -> Unit = {}) {
    var query by rememberSaveable { mutableStateOf("") }
    val filter = parseSearch(query)
    var all = state.rooms
    // URLやハッシュで指定された部屋に、いま誰もいない場合も、入れるように出す
    if (filter?.exact != null && all.none { it.key == filter.exact }) {
        all = (all + RoomInfo(filter.exact, 0, false, emptyList(), invited = false, isCurrent = false)).sortedBy { it.key }
    }
    val shown = if (filter == null) all else all.filter { matchSearch(it, filter) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("いまある部屋（赤い線でタップ）", color = PochiColors.Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
            Text(
                if (filter != null) "🔍 ${shown.size} / ${all.size}部屋" else "👥 ${state.totalPeople}人 / ${all.size}部屋",
                color = PochiColors.Muted,
                fontSize = 12.sp,
            )
        }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("🔍 URL・ハッシュ・名前・話題", fontSize = 13.sp, maxLines = 1) },
            singleLine = true,
            colors = pochiFieldColors(),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth(),
        )
        if (showReconnect) {
            SubButton(
                onClick = { PochiEngine.reconnect(auto = false) },
                enabled = !state.reconnecting,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.reconnecting) "再接続中…" else "↻ 一覧を再接続") }
        }
        // 先頭: ボットの部屋、招待された部屋 (Web版と同じ並び)
        var ordered = shown
        // 先頭: おうむの部屋 (新しい番号だけ。旧い番号は、ふつうの部屋と同じ並び)
        ordered = listOfNotNull(ordered.firstOrNull { it.key == BOT_ROOM_KEY }) + ordered.filter { it.key != BOT_ROOM_KEY }
        state.pendingKey?.let { pk -> ordered = listOfNotNull(ordered.firstOrNull { it.key == pk }) + ordered.filter { it.key != pk } }
        RoomDial(
            rooms = ordered,
            connected = state.peers.size + 1,
            pendingKey = state.pendingKey,
            emptyText = when {
                filter != null -> "該当する部屋がありません"
                state.ready -> "いまある部屋はありません。新しい部屋を作ってください"
                else -> "スキャン中..."
            },
            onJoin = onJoin,
            onCenter = onCenter,
        )
        // 応援のお願い (ダイヤルの下)
        Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("応援お願いします。", color = PochiColors.Text, fontSize = 13.sp)
            val uri = androidx.compose.ui.platform.LocalUriHandler.current
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SubButton(onClick = { uri.openUri("https://ofuse.me/ryotasoftware") }, modifier = Modifier.weight(1f), container = Color(0xFF1E293B)) {
                    Text("💌", fontSize = 18.sp)
                    Spacer(Modifier.width(6.dp))
                    Text("OFUSE", fontSize = 14.sp, maxLines = 1)
                }
                SubButton(onClick = { uri.openUri("https://buymeacoffee.com/ryota_software") }, modifier = Modifier.weight(1f), container = Color(0xFF1E293B)) {
                    Text("☕", fontSize = 18.sp)
                    Spacer(Modifier.width(6.dp))
                    Text("Coffee", fontSize = 14.sp, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun RoomRow(room: RoomInfo, onJoin: (String) -> Unit) {
    val border = when {
        room.air -> PochiColors.Tx
        room.isCurrent -> PochiColors.Accent
        else -> PochiColors.ChipBorder
    }
    val bg = if (room.isCurrent) Color(0xFF172554) else PochiColors.Chip
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(10.dp))
            .clickable(enabled = !room.isCurrent) { onJoin(room.key) }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        val label = (if (room.air) "🔴 " else "🔵 ") + formatKey(room.key) + " · 👤${room.count}" +
            (if (room.invited) " · 招待" else "") + (if (room.isCurrent) " · 入室中" else "")
        Text(label, color = PochiColors.Text, fontFamily = FontFamily.Monospace, fontSize = 14.sp)
        if (room.tag.isNotEmpty()) {
            Text(
                "🏷 " + room.tag + (if (room.tagBy.isNotEmpty()) "（${room.tagBy}）" else ""),
                color = Color(0xFF93C5FD), // Web版の .chip-tag と同じ色
                fontSize = 12.sp,
            )
        }
        val who = when {
            room.invited -> "招待された部屋（現在は無人）"
            room.count == 0 && room.names.isEmpty() -> "この部屋には、いま誰もいません（タップで入る）"
            else -> room.names.joinToString("、")
        }
        Text(who, color = PochiColors.Muted, fontSize = 12.sp)
    }
}

/** "**太字**" を太字にする簡単な変換。 */
fun boldMarkup(text: String) = buildAnnotatedString {
    val parts = text.split("**")
    parts.forEachIndexed { i, part ->
        if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color.White)) { append(part) }
        else append(part)
    }
}

@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Switch(checked = checked, onCheckedChange = onChange)
        Text(label, color = PochiColors.Text, fontSize = 13.sp, modifier = Modifier.weight(1f))
    }
}

/** 入力レベル (マイクの増幅 0〜30dB)。ホームの基本設定と、無線機画面の両方に出す (同じ設定)。 */
@Composable
fun InputLevelSetting(state: UiState) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("入力レベル（マイクの増幅）", color = PochiColors.Text, fontSize = 13.sp)
            Text(
                if (state.micGainDb == 0) "そのまま" else "+${state.micGainDb} dB",
                color = PochiColors.Sky,
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
            )
        }
        Slider(
            value = state.micGainDb.toFloat(),
            onValueChange = { PochiEngine.setMicGainDb(it.toInt()) },
            valueRange = 0f..30f,
            steps = 9,
        )
        Text(
            "相手に声が小さく聞こえるときに右へ。上げすぎると割れます（+6dBで約2倍、+20dBで10倍）。端末ごとに保存されます。",
            color = PochiColors.Muted,
            fontSize = 11.sp,
        )
    }
}

/** Web版の LEVEL 表示: 24セグメント、緑→黄→赤、ピークホールド付き。 */
@Composable
fun LevelMeter(meter: MeterState) {
    val segs = 24
    // Web版と同じ: ラベルはいつも控えめな灰色。マイクの待機表示 (MIC) のときは、点灯を薄くして差をつける
    val labelColor = PochiColors.Muted
    val lit = if (meter.label == "MIC") 0.38f else 1f
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            meter.label,
            color = labelColor,
            fontFamily = FontFamily.Monospace,
            fontSize = 10.sp,
            modifier = Modifier.width(38.dp),
        )
        Canvas(
            Modifier
                .weight(1f)
                .height(14.dp),
        ) {
            val gap = 3.dp.toPx()
            val w = (size.width - gap * (segs - 1)) / segs
            for (i in 0 until segs) {
                val pos = (i + 1f) / segs
                val on = pos <= meter.level + 0.001f
                val isPeak = abs(pos - meter.peak) < 0.5f / segs + 0.001f && meter.peak > 0.02f
                val col = when {
                    pos > 0.85f -> PochiColors.Tx
                    pos > 0.65f -> PochiColors.Amber
                    else -> PochiColors.Rx
                }
                drawRect(
                    color = col.copy(alpha = if (on || isPeak) lit else 0.16f),
                    topLeft = Offset(i * (w + gap), 0f),
                    size = Size(w, size.height),
                )
            }
        }
        Text(
            meter.dbText,
            color = PochiColors.Muted,
            fontFamily = FontFamily.Monospace,
            fontSize = 10.sp,
            textAlign = TextAlign.End,
            modifier = Modifier.width(52.dp),
        )
    }
}


/** Web版の .btn-sub と同じ見た目のボタン (グレーの角丸、白い文字)。 */
@Composable
fun SubButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    container: Color = Color(0xFF374151),
    small: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = Color.White,
            disabledContainerColor = container.copy(alpha = 0.5f),
            disabledContentColor = Color.White.copy(alpha = 0.6f),
        ),
        contentPadding = if (small) PaddingValues(horizontal = 10.dp, vertical = 4.dp) else PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        content = content,
    )
}

/** Web版の input と同じ色 (濃い背景、グレーの枠、フォーカスで青)。 */
@Composable
fun pochiFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = Color(0xFF111827),
    unfocusedContainerColor = Color(0xFF111827),
    focusedBorderColor = PochiColors.Accent,
    unfocusedBorderColor = Color(0xFF374151),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedLabelColor = PochiColors.Muted,
    unfocusedLabelColor = PochiColors.Muted,
    focusedPlaceholderColor = PochiColors.Muted,
    unfocusedPlaceholderColor = PochiColors.Muted,
)
