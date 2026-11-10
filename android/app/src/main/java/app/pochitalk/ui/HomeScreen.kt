package app.pochitalk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.height
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.Brush
import app.pochitalk.engine.PttPosition
import app.pochitalk.engine.MeterState
import app.pochitalk.engine.formatKey
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.UiState

/** ハンドルネームと設定 (Web版の idleSlot)。入室前の無線機の中、大きなボタンの下に出す。ダイアログもここで持つ。 */
@Composable
fun HomeFields(state: UiState, actions: Actions) {
    var showSettings by remember { mutableStateOf(false) }
    var showAbout by remember { mutableStateOf(false) }
    // 起動したときだけ初回案内を出す (画面の回転では出し直さない)
    var showWelcome by rememberSaveable { mutableStateOf(state.welcomeOn || !state.consentOk) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = state.nickname,
            onValueChange = { if (it.length <= 12) PochiEngine.setNickname(it) },
            label = { Text("ハンドルネーム") },
            supportingText = { Text("みんなに見える、あなたの名前", color = PochiColors.Muted, fontSize = 12.sp) },
            singleLine = true,
            colors = pochiFieldColors(),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { if (!it.isFocused) PochiEngine.commitNickname() },
        )
        SubButton(
            onClick = { showSettings = true },
            modifier = Modifier.fillMaxWidth().border(1.dp, Color(0xFF94A3B8), RoundedCornerShape(8.dp)),
            container = Color(0xFF475569),
        ) {
            Text("⚙ 設定（マイク・このアプリについて）")
        }
    }
    if (showWelcome) {
        WelcomeDialog(
            state,
            onSettings = { showWelcome = false; showSettings = true },
            onAbout = { showWelcome = false; showAbout = true },
            onClose = { showWelcome = false },
        )
    }
    if (showSettings) {
        SettingsDialog(state, actions, onShowAbout = { showAbout = true }, onDismiss = { showSettings = false })
    }
    if (showAbout) AboutDialog(onDismiss = { showAbout = false })
}

/** 入室していないときの液晶 (Web版と同じ): 見出し「ダイヤルの部屋」、LEVEL、タグ、TX/RX と「入室していません」、いる人、人数。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun IdlePanel(state: UiState, centerKey: String?, meter: MeterState) {
    val room = state.rooms.firstOrNull { it.key == centerKey }
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PochiColors.Panel)
            .border(2.dp, Color(0xFF22272E), shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("ダイヤルの部屋", color = PochiColors.Muted, fontFamily = FontFamily.Monospace, fontSize = 12.sp, letterSpacing = 3.sp)
            Text(
                if (centerKey != null) formatKey(centerKey) else "----·----",
                color = PochiColors.Sky.copy(alpha = 0.55f), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Black, fontSize = 38.sp,
            )
            Spacer(Modifier.height(18.dp))
            LevelMeter(meter)
        }
        val tagText = when {
            room == null -> "🏷 話題タグ：まだありません"
            room.tag.isNotEmpty() -> "🏷 " + room.tag + (if (room.tagBy.isNotEmpty()) "（${room.tagBy}）" else "")
            else -> "🏷 話題タグ：まだありません"
        }
        Text(tagText, color = PochiColors.Muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().alpha(0.7f))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Led(false, PochiColors.Tx)
                    Text("TX", color = PochiColors.Muted, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Led(false, PochiColors.Rx)
                    Text("RX", color = PochiColors.Muted, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
                }
            }
            Text("入室していません", color = Color(0xFF94A3B8), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        FlowRow(Modifier.fillMaxWidth().alpha(0.7f), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when {
                room == null -> {}
                room.invited -> Text("招待された部屋（現在は無人）", color = PochiColors.Muted, fontSize = 13.sp)
                room.names.isEmpty() -> Text("この部屋には、いま誰もいません", color = PochiColors.Muted, fontSize = 13.sp)
                else -> room.names.forEach {
                    Text(it, color = PochiColors.Muted, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(PochiColors.Chip).padding(horizontal = 8.dp, vertical = 1.dp))
                }
            }
        }
        if (room != null && room.count > 0) {
            Text("👤 ${room.count}人", color = PochiColors.Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End)
        }
    }
}

/**
 * 入室していないときの大きな丸ボタン (話すボタンと同じ場所・大きさ)。
 * 招待で開いたときは「JOIN 入室」(あとで / 新しい部屋を作る / 使い方・プライバシー のリンク付き)、
 * どこにも入っていないときは「NEW 新しい部屋」。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun IdleControls(state: UiState, actions: Actions) {
    var showAbout by remember { mutableStateOf(false) }
    val invited = state.pendingKey
    val join = invited != null
    val brush = Brush.radialGradient(listOf(Color(0xFF3B82F6), Color(0xFF1D4ED8))) // Web版と同じ青 (話すボタンと同じ色)
    val ring = Color(0xFF1E3A8A)
    val align = when (state.pttPos) { PttPosition.LEFT -> Alignment.CenterStart; PttPosition.RIGHT -> Alignment.CenterEnd; else -> Alignment.Center }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth().padding(bottom = 14.dp), contentAlignment = align) {
            // VOX の丸ボタン (入室前は押せない。話すボタンの左下)
            Column(
                Modifier
                    .align(if (state.pttPos == PttPosition.RIGHT) Alignment.BottomStart else Alignment.BottomStart)
                    .offset(y = 14.dp)
                    .size(62.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF1F2937))
                    .border(3.dp, Color(0xFF374151), CircleShape)
                    .alpha(0.55f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("VOX", color = PochiColors.Muted, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, letterSpacing = 1.sp)
                Text("OFF", color = PochiColors.Muted, fontWeight = FontWeight.ExtraBold, fontSize = 10.sp)
            }
            Box(
                Modifier
                    .size(170.dp)
                    .clip(CircleShape)
                    .background(brush)
                    .border(6.dp, ring, CircleShape)
                    .clickable { if (invited != null) actions.join(invited) else actions.create() },
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (join) "JOIN" else "NEW", color = Color.White, fontWeight = FontWeight.Black, fontSize = 24.sp)
                    Text(if (join) "入室" else "新しい部屋", color = Color.White.copy(alpha = 0.9f), fontSize = 14.sp, letterSpacing = 2.sp)
                }
            }
        }
        if (join) {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
                TextButton(onClick = { PochiEngine.dismissPending() }) { Text("あとで", fontSize = 13.sp) }
                TextButton(onClick = { PochiEngine.dismissPending(); actions.create() }) { Text("新しい部屋を作る", fontSize = 13.sp) }
                TextButton(onClick = { showAbout = true }) { Text("使い方・プライバシー", fontSize = 13.sp) }
            }
        }
    }
    if (showAbout) AboutDialog(onDismiss = { showAbout = false })
}
