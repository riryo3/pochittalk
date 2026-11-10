package app.pochitalk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import android.os.SystemClock
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.pochitalk.engine.MeterState
import app.pochitalk.engine.PeerInfo
import app.pochitalk.engine.FaxPaper
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.PttPosition
import app.pochitalk.engine.StatusKind
import app.pochitalk.engine.UiState
import app.pochitalk.engine.formatKey
import kotlin.math.abs

/**
 * 無線機画面: Web版と同じく、1つの「無線機」カードの中に、ヘッダー / 液晶 (ROOM HASH・レベル・話題タグ・状態・参加者) /
 * 話すボタン / 招待・再接続・VOX・効果音 を並べる。スクロールして液晶が見えなくなると、上にルームハッシュのバーが出る。
 * 部屋一覧は、Web版と同じく、無線機の下に並べる。
 */
@Composable
fun RadioScreen(state: UiState, rawActions: Actions, onOpenRooms: () -> Unit, modifier: Modifier = Modifier) {
    val key = state.currentKey
    // 入室・新しい部屋・退室は、確認してから実行する (招待リンクの「JOIN 入室」だけは確認しない)
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    val actions = remember(rawActions, key, state.rooms) {
        Actions(
            join = { k ->
                val r = state.rooms.firstOrNull { it.key == k }
                if (k == key || (r != null && r.count >= 8 && !r.isCurrent)) rawActions.join(k) // すでにいる部屋・満員は、確認の前にエンジンが知らせる
                else confirm = Confirm.Join(k, r?.count ?: 0)
            },
            create = { confirm = Confirm.New },
            leave = { confirm = Confirm.Leave },
            share = rawActions.share,
            micTest = rawActions.micTest,
        )
    }
    var centerKey by remember { mutableStateOf<String?>(null) }
    var drawerOpen by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val showSticky by remember { derivedStateOf { key != null && scroll.value > with(density) { 220.dp.toPx() } } }
    // 部屋に入ったら、引き出しは閉じる
    LaunchedEffect(key) { drawerOpen = false }
    Box(modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(scroll)
                .padding(16.dp),
        ) {
            DeviceCard(state, key, centerKey, actions, rawActions, onOpenRooms = { drawerOpen = true })
            Spacer(Modifier.height(10.dp))
            val ver = remember { runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "" }
            Text("版 $ver", color = PochiColors.Muted, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().alpha(0.7f))
            Spacer(Modifier.height(if (key != null) 72.dp else 24.dp)) // 入室中は、下に出るモールスの帯の分をあける
        }
        if (showSticky) {
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(Color(0xF2141820))
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(formatKey(key ?: ""), color = PochiColors.Sky, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                SubButton(onClick = actions.leave, small = true) { Text("退出", fontSize = 12.sp) }
            }
        }
        // 部屋を探すダイヤルは、Web版 (狭い画面) と同じく、左端から出る引き出しに入れる
        RoomDrawer(open = drawerOpen, onOpen = { drawerOpen = true }, onClose = { drawerOpen = false }) {
            RoomListCard(state, { drawerOpen = false; actions.join(it) }, showReconnect = key == null, onCenter = { centerKey = it })
        }
        confirm?.let { c ->
            val inRoom = key != null
            val msg = when (c) {
                is Confirm.Join -> "この部屋に入室しますか？\n" + formatKey(c.key) + (if (c.count > 0) "（いま ${c.count} 人）" else "") + (if (inRoom) "\nいまの部屋からは退出します。" else "")
                Confirm.New -> "新しい部屋を作って、入室しますか？" + (if (inRoom) "\nいまの部屋からは退出します。" else "")
                Confirm.Leave -> "この部屋から退出しますか？"
            }
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { confirm = null },
                text = { Text(msg, fontSize = 15.sp, lineHeight = 22.sp) },
                confirmButton = {
                    androidx.compose.material3.TextButton(onClick = {
                        confirm = null
                        when (c) {
                            is Confirm.Join -> rawActions.join(c.key)
                            Confirm.New -> rawActions.create()
                            Confirm.Leave -> rawActions.leave()
                        }
                    }) { Text(if (c == Confirm.Leave) "退出する" else "入室する") }
                },
                dismissButton = { androidx.compose.material3.TextButton(onClick = { confirm = null }) { Text("やめる") } },
            )
        }
        // モールスのキーボードは、Web版と同じく画面の下に固定し、開いたら話すボタンの上に被せる (画面を広げない)。左の引き出しやタブよりも前に出す
        if (key != null) {
            Box(Modifier.align(Alignment.BottomCenter).padding(horizontal = 10.dp, vertical = 8.dp)) { MorseDrawer(state) }
        }
    }
}

private sealed interface Confirm {
    data class Join(val key: String, val count: Int) : Confirm
    object New : Confirm
    object Leave : Confirm
}

/** 左端の「部屋を探す ▶」タブから出る引き出し (Web版の dial-tab / #dialCard)。 */
@Composable
private fun RoomDrawer(open: Boolean, onOpen: () -> Unit, onClose: () -> Unit, content: @Composable () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = minOf(maxWidth * 0.88f, 400.dp)
        val x by animateDpAsState(if (open) 0.dp else -(w + 8.dp), label = "drawer")
        if (open) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
            )
        }
        val drawerShape = RoundedCornerShape(topEnd = 20.dp, bottomEnd = 20.dp)
        Column(
            Modifier
                .offset(x = x)
                .width(w)
                .fillMaxHeight()
                .clip(drawerShape)
                .background(PochiColors.Card)
                .border(2.dp, PochiColors.Border, drawerShape)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) { content() }
        val tabShape = RoundedCornerShape(topEnd = 14.dp, bottomEnd = 14.dp)
        val tabH = minOf(430.dp, maxHeight * 0.78f)
        val tabX = if (open) w else 0.dp
        Column(
            Modifier
                .align(Alignment.CenterStart)
                .offset(x = tabX)
                .width(34.dp)
                .height(tabH)
                .clip(tabShape)
                .background(Color(0xFF1F2937))
                .border(1.dp, Color(0xFF374151), tabShape)
                .clickable(onClick = if (open) onClose else onOpen),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            val label = if (open) "◀閉じる" else "部屋を探す▶"
            label.forEach { Text(it.toString(), color = Color(0xFFCBD5E1), fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 17.sp) }
        }
    }
}

@Composable
private fun DeviceCard(state: UiState, key: String?, centerKey: String?, actions: Actions, rawActions: Actions, onOpenRooms: () -> Unit) {
    val shape = RoundedCornerShape(28.dp)
    val meter by PochiEngine.meter.collectAsStateWithLifecycle()
    // 無線機を裏返して、招待のQRコードを見せる (部屋を移ったら表に戻る)
    var showQr by rememberSaveable(key) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(16.dp, shape)
            .clip(shape)
            .background(PochiColors.Card)
            .border(2.dp, PochiColors.Border, shape)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // ヘッダー
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Brand()
                if (key != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SubButton(
                        onClick = { PochiEngine.reconnect(auto = false) },
                        enabled = !state.reconnecting,
                        small = true,
                    ) { Text(if (state.reconnecting) "再接続中…" else "再接続", fontSize = 12.sp) }
                    SubButton(onClick = actions.leave, small = true) { Text("退出", fontSize = 12.sp) }
                }
            }
            HorizontalDivider(thickness = 2.dp, color = PochiColors.Border)
        }
        if (key == null) {
            IdlePanel(state, centerKey, meter)
            IdleControls(state, Actions(join = rawActions.join, create = actions.create, leave = actions.leave, share = actions.share, micTest = actions.micTest))
            HomeFields(state, actions)
        } else if (showQr) {
            QrBackFace(key) // 閉じるボタンは無し。下のQRボタンでもう一度押すと元に戻る
        } else {
            DisplayPanel(state, key, meter)
            PttSection(transmitting = state.ledTx, voxOn = state.voxOn, lefty = state.lefty, pos = state.pttPos, onOpenRooms = onOpenRooms)
        }
        // フッター
        if (key != null) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SubButton(onClick = actions.share, modifier = Modifier.weight(1f)) { Text("招待URLを送る", fontSize = 13.sp) }
                // QRコードで招待 (無線機を裏返す)
                SubButton(
                    onClick = { showQr = !showQr },
                    container = if (showQr) Color(0xFF1D4ED8) else Color(0xFF374151),
                    modifier = Modifier.width(64.dp),
                ) { QrIcon() }
                // スピーカーのミュート (相手の声と効果音を止める。マイクは止めない)
                SubButton(
                    onClick = { PochiEngine.toggleSpeakerMute() },
                    container = if (state.speakerMuted) Color(0xFF7F1D1D) else Color(0xFF374151),
                    modifier = Modifier.width(64.dp),
                ) { Text(if (state.speakerMuted) "🔇" else "🔈", fontSize = 18.sp) }
            }
            VoxSection(state)
        }
    }
}

/** 液晶: ROOM HASH / レベルメーター / 話題タグ / TX・RX・状態 / 参加者 (Web版の .display)。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DisplayPanel(state: UiState, key: String, meter: MeterState) {
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
            Text("ROOM HASH", color = PochiColors.Muted, fontFamily = FontFamily.Monospace, fontSize = 12.sp, letterSpacing = 3.sp)
            Text(
                formatKey(key),
                color = PochiColors.Sky,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Black,
                fontSize = 38.sp,
            )
            val sub = state.flash ?: state.morseText
            val isMorse = state.flash == null && state.morseText.isNotEmpty()
            Text(
                sub,
                color = if (isMorse) PochiColors.Amber else PochiColors.Muted,
                fontFamily = if (isMorse) FontFamily.Monospace else FontFamily.Default,
                fontSize = if (isMorse) 14.sp else 12.sp,
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier = Modifier.height(18.dp),
            )
            LevelMeter(meter)
        }
        state.fax?.let { FaxPaperView(it) }
        TagRow(state, key)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Led(state.ledTx, PochiColors.Tx)
                    Text("TX", color = PochiColors.Muted, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Led(state.ledRx, PochiColors.Rx)
                    Text("RX", color = PochiColors.Muted, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
                }
            }
            val statusColor = when (state.status) {
                StatusKind.TX -> PochiColors.Tx
                StatusKind.RX -> PochiColors.Rx
                StatusKind.CROSSTALK -> Color(0xFFF59E0B)
                StatusKind.STANDBY -> PochiColors.Sky
            }
            Text(state.statusText, color = statusColor, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        // 参加者 (上に点線)
        Box(
            Modifier
                .fillMaxWidth()
                .drawBehind {
                    drawLine(
                        color = Color(0xFF2D3748),
                        start = Offset(0f, 0f),
                        end = Offset(size.width, 0f),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)),
                    )
                }
                .padding(top = 10.dp),
        ) {
            FlowRow(
                modifier = Modifier.heightIn(max = 110.dp).verticalScroll(rememberScrollState()).padding(bottom = if (state.presentCount > 0) 16.dp else 0.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                // 自分 (Web版と同じ): 先頭に青い名札。話しているときは赤く光る
                val sending = state.ledTx
                val myName = (if (state.logMode) "💾" else "") + state.nickname.trim().ifEmpty { "NoName" }
                Text(
                    myName + "（自分）",
                    color = if (sending) Color(0xFFFECACA) else Color(0xFFBFDBFE),
                    fontWeight = if (sending) FontWeight.Bold else FontWeight.Normal,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (sending) Color(0xFF7F1D1D) else Color(0xFF172554))
                        .padding(horizontal = 8.dp, vertical = 1.dp),
                )
                state.peers.forEach { p ->
                    Text(
                        p.name,
                        color = if (p.talking) Color(0xFF34D399) else PochiColors.Muted,
                        fontWeight = if (p.talking) FontWeight.Bold else FontWeight.Normal,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (p.talking) Color(0xFF064E3B) else PochiColors.Chip)
                            .padding(horizontal = 8.dp, vertical = 1.dp),
                    )
                }
                // 一覧にはいるが、まだ音声がつながっていない人 (つながったら消える)
                state.missingNames.forEach { nm ->
                    Text(
                        nm,
                        color = Color(0xFFFECACA),
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFF450A0A))
                            .border(1.dp, Color(0xFFEF4444), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 1.dp),
                    )
                }
                if (state.peers.isEmpty() && state.missingNames.isEmpty()) {
                    Text("（ほかの参加者を待っています）", color = PochiColors.Muted, fontSize = 13.sp, modifier = Modifier.alpha(0.6f).padding(vertical = 2.dp))
                }
            }
            if (state.presentCount > 0) {
                val ok = state.connectedCount >= state.presentCount
                Text(
                    "接続 ${state.connectedCount} / 在室 ${state.presentCount}" +
                        (if (state.audioOkCount in 1 until state.connectedCount) "（音声OK ${state.audioOkCount}）" else ""),
                    color = if (ok) PochiColors.Rx else PochiColors.Amber,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.align(Alignment.BottomEnd),
                )
            }
        }
    }
}

/** 話題タグの行 (Web版の .tag-row): 誰でもつけられ、付けた人の名前が添えられる。部屋の一覧にも出る。 */
@Composable
private fun TagRow(state: UiState, key: String) {
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(TextFieldValue("")) }
    fun commit() {
        PochiEngine.setTag(draft.text)
        editing = false
    }
    // おうむ返しボットの部屋は、タグが固定で、書き換えられない (Web版と同じ)
    if (app.pochitalk.engine.isBotRoom(key)) {
        Text(
            "🏷 🦜 おうむ返しの部屋（話すと、あなたにだけ声が返ります）",
            color = PochiColors.Muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    Column {
        // タグの行: 「🏷 タグ（○○が付けた）」と、右に「つける/変える」 (Web版の .tag-row)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val label = buildAnnotatedString {
                if (state.roomTag.isEmpty()) {
                    append("🏷 話題タグ：まだありません")
                } else {
                    append("🏷 ")
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = PochiColors.Text)) { append(state.roomTag) }
                    if (state.roomTagBy.isNotEmpty()) {
                        withStyle(SpanStyle(fontSize = 11.sp, color = PochiColors.Muted.copy(alpha = 0.8f))) { append("  （${state.roomTagBy}が付けた）") }
                    }
                }
            }
            Text(label, color = PochiColors.Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            SubButton(onClick = {
                editing = !editing
                // 前のタグを残して、末尾にカーソルを置く (少し直したいとき用)
                if (editing) draft = TextFieldValue(state.roomTag, TextRange(state.roomTag.length))
            }, small = true) { Text(if (state.roomTag.isEmpty()) "つける" else "変える", fontSize = 12.sp) }
        }
        // 入力フォーム: 入力欄と「確定」を同じ行に並べ、文字数はその下の右寄せ (Web版の #tagForm)
        if (editing) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.text.codePointCount(0, it.text.length) <= 30) draft = it },
                    placeholder = { Text("いまの話題（例：ゲームの話）", fontSize = 11.sp, maxLines = 1) },
                    singleLine = true,
                    colors = pochiFieldColors(),
                    shape = RoundedCornerShape(8.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Ascii, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { commit() }),
                    modifier = Modifier.weight(1f),
                )
                SubButton(onClick = { commit() }) { Text("確定") }
            }
            val n = draft.text.codePointCount(0, draft.text.length)
            Text(
                "$n / 30 文字",
                color = if (n >= 30) PochiColors.Amber else PochiColors.Muted,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                textAlign = TextAlign.End,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun PttSection(transmitting: Boolean, voxOn: Boolean, lefty: Boolean, pos: PttPosition, onOpenRooms: () -> Unit) {
    // VOX の丸ボタンは、話すボタンの左下に置く (左手用は右下)。下に少しはみ出すので、余白を取る
    BoxWithConstraints(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        // 話すボタンの位置 (左 / 中央 / 右)。VOX の丸ボタンは、話すボタンの空いている側に付く:
        //   左寄せ→右側、右寄せ→左側、中央→左側 (左手用ならば右側)
        val circle = 170.dp
        val circleLeft = when (pos) {
            PttPosition.LEFT -> 0.dp
            PttPosition.CENTER -> (maxWidth - circle) / 2
            PttPosition.RIGHT -> maxWidth - circle
        }
        val voxOnLeft = when (pos) {
            PttPosition.LEFT -> false
            PttPosition.RIGHT -> true
            PttPosition.CENTER -> !lefty
        }
        val voxLeft = if (voxOnLeft) (circleLeft - 65.dp).coerceAtLeast(0.dp) else (circleLeft + circle + 3.dp).coerceAtMost(maxWidth - 62.dp)
        val brush = if (transmitting) {
            Brush.radialGradient(listOf(Color(0xFFEF4444), Color(0xFFB91C1C)))
        } else {
            Brush.radialGradient(listOf(Color(0xFF3B82F6), Color(0xFF1D4ED8)))
        }
        Box(
            Modifier
                .align(Alignment.TopStart)
                .offset(x = circleLeft)
                .size(170.dp)
                .scale(if (transmitting) 0.96f else 1f)
                .clip(CircleShape)
                .background(brush)
                .border(6.dp, if (transmitting) Color(0xFF7F1D1D) else Color(0xFF1E3A8A), CircleShape)
                .pointerInput(Unit) {
                    // 指がボタン (円) の上にいる間は、どれだけ動いてもスワイプとみなさない。
                    // 円の縁から約14dp以上離れたときだけ、スワイプ (= 部屋一覧のスワイプ) とみなして、
                    // 送信を始めない / 送信中なら直ちに止める。
                    // 円の上にいる間は動きを消費して、親 (部屋一覧のドロワー・画面のスクロール) に取られないようにする。
                    // 円の外に出たら消費をやめるので、そこから先は一覧のスワイプとして扱われる。
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val outsideRadius = size.width / 2f + 14.dp.toPx()
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val g = PttGesture(center.x, center.y, outsideRadius)
                        g.onDown(SystemClock.uptimeMillis(), down.position.x, down.position.y)
                        fun apply(action: PttGesture.Action) {
                            when (action) {
                                PttGesture.Action.START -> PochiEngine.pttPress()
                                PttGesture.Action.RELEASE -> PochiEngine.pttRelease()
                                PttGesture.Action.ABORT -> PochiEngine.pttAbort()
                                PttGesture.Action.SWIPE, PttGesture.Action.NONE -> {}
                            }
                        }
                        try {
                            while (true) {
                                val wait = if (g.state == PttGesture.State.WAITING) g.remainingMs(SystemClock.uptimeMillis()) else Long.MAX_VALUE
                                val event = if (wait == Long.MAX_VALUE) awaitPointerEvent() else withTimeoutOrNull(wait.coerceAtLeast(1L)) { awaitPointerEvent() }
                                if (event == null) {
                                    apply(g.onTimer(SystemClock.uptimeMillis()))
                                    continue
                                }
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                if (!change.pressed) {
                                    apply(g.onUp())
                                    return@awaitEachGesture
                                }
                                val moveAction = g.onMove(SystemClock.uptimeMillis(), change.position.x, change.position.y)
                                apply(moveAction)
                                if (moveAction == PttGesture.Action.ABORT || moveAction == PttGesture.Action.SWIPE) {
                                    // 円の外に出た: 右向きの動きなら、部屋一覧のスワイプとして一覧を開く。
                                    // (円の上にいる間は動きを消費していたので、親のドロワーは、このスワイプを自分では拾えない)
                                    if (change.position.x - down.position.x > 0f) onOpenRooms()
                                }
                                // 円の上にいる間 (待ち・送信中) は、動きを親に渡さない
                                if (g.state == PttGesture.State.WAITING || g.state == PttGesture.State.TALKING) change.consume()
                            }
                        } finally {
                            // 途中で取り消されたときも、送信したままにしない
                            if (g.state == PttGesture.State.TALKING) apply(g.onCancel())
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("PUSH", color = Color.White, fontWeight = FontWeight.Black, fontSize = 21.sp)
                Text("TO TALK", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, letterSpacing = 2.sp)
            }
        }
        VoxButton(
            on = voxOn,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .offset(x = voxLeft, y = 14.dp),
        )
    }
}

/** VOX の丸ボタン (Web版の .vox-btn): オフは灰色、オンは緑に光る。 */
@Composable
private fun VoxButton(on: Boolean, modifier: Modifier = Modifier) {
    val brush: Brush = if (on) Brush.radialGradient(listOf(Color(0xFF34D399), Color(0xFF059669))) else SolidColor(Color(0xFF1F2937))
    Column(
        modifier
            .then(if (on) Modifier.shadow(14.dp, CircleShape, spotColor = Color(0xFF10B981)) else Modifier)
            .size(62.dp)
            .clip(CircleShape)
            .background(brush)
            .border(3.dp, if (on) Color(0xFF065F46) else Color(0xFF374151), CircleShape)
            .clickable { PochiEngine.setVox(!on) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        val c = if (on) Color(0xFF052E1C) else PochiColors.Muted
        Text("VOX", color = c, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, letterSpacing = 1.sp)
        Text(if (on) "ON" else "OFF", color = c.copy(alpha = 0.85f), fontWeight = FontWeight.ExtraBold, fontSize = 10.sp)
    }
}

@Composable
private fun VoxSection(state: UiState) {
    if (state.voxOn) {
        // メーター: 緑 = 入力レベル、黄色の線 = しきい値。しきい値を超えると赤
        Box(
            Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(PochiColors.Panel)
                .border(1.dp, PochiColors.Border, RoundedCornerShape(5.dp)),
        ) {
            val over = state.voxLevel > state.voxThreshold
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(state.voxLevel.coerceIn(0f, 1f))
                    .background(if (over) PochiColors.Tx else PochiColors.Rx),
            )
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.fillMaxWidth(state.voxThreshold.coerceIn(0f, 1f)))
                Box(
                    Modifier
                        .fillMaxHeight()
                        .width(2.dp)
                        .background(PochiColors.Amber),
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("しきい値", color = PochiColors.Muted, fontSize = 13.sp)
            Slider(
                value = state.voxSens.toFloat(),
                onValueChange = { PochiEngine.setVoxSensitivity(it.toInt()) },
                valueRange = 1f..10f,
                steps = 8,
                modifier = Modifier.weight(1f),
            )
        }
        Text(
            "スピーカーの音を拾いやすいので、イヤホンがおすすめです。入力レベルは、ホームの「設定」で変えられます。",
            color = PochiColors.Muted,
            fontSize = 11.sp,
        )
    }
}


/** 受信した FAX の紙 (Web版の faxCanvas): 白い紙に、上から 1 行ずつ黒い画素が出てくる。タップで片づける。 */
@Composable
fun FaxPaperView(paper: FaxPaper) {
    Column(
        Modifier.fillMaxWidth().clickable { PochiEngine.dismissFax() },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            "FAX" + if (paper.from.isNotEmpty()) "  ${paper.from} より" else "",
            color = PochiColors.Muted, fontFamily = FontFamily.Monospace, fontSize = 11.sp, letterSpacing = 2.sp,
        )
        Canvas(
            Modifier
                .fillMaxWidth()
                .aspectRatio(paper.cols / 15f)
                .clip(RoundedCornerShape(4.dp))
                .background(Color(0xFFF8F8F0)),
        ) {
            val cell = size.width / paper.cols
            val rows = minOf(paper.shownRows, 15)
            for (y in 0 until rows) for (x in 0 until paper.cols) {
                if (paper.black[y * paper.cols + x]) {
                    drawRect(Color(0xFF141414), Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
                }
            }
        }
    }
}

/** モールスで送る (Web版の morse-drawer): 専用キーボードのキーを押すと、その文字が 700Hz の音で送信される。「fax」と打つと(隠し)FAXモード。 */
@Composable
private fun MorseDrawer(state: UiState) {
    var open by rememberSaveable { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Color(0xFF1F2937))
            .border(1.dp, Color(0xFF374151), shape),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (state.faxMode) "📠 FAXモード" else "⌨ モールスで送る", color = Color(0xFFCBD5E1), fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(
                if (state.morseQueued.isNotEmpty()) "送信待ち ${state.morseQueued}" else if (open) "▼ 閉じる" else "▲ 開く",
                color = if (state.morseQueued.isNotEmpty()) PochiColors.Amber else PochiColors.Muted,
                fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false).padding(start = 8.dp),
            )
        }
        if (open) {
            Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (state.faxMode) {
                    Text(
                        if (state.faxText.isNotEmpty()) state.faxText + "▌" else "FAXモード: 文字を打って ⏎ で送信（ESCで終了）",
                        color = if (state.faxText.isNotEmpty()) PochiColors.Amber else PochiColors.Muted,
                        fontFamily = FontFamily.Monospace, fontSize = 14.sp,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
                    )
                }
                val rows = listOf("1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM", ".,?!/-:")
                rows.forEachIndexed { ri, r ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (ri == 3) MorseKey("ESC", "ESC", Modifier.weight(1.6f))
                        r.forEach { c -> MorseKey(c.toString(), c.toString(), Modifier.weight(1f)) }
                        if (ri == 3) MorseKey("⌫", "BS", Modifier.weight(1.6f))
                        if (ri == 4) {
                            if (state.faxMode) MorseKey("⏎", "ENTER", Modifier.weight(1.6f), Color(0xFF1D4ED8))
                        }
                    }
                }
                if (state.morseSending) {
                    SubButton(onClick = { PochiEngine.abortMorse() }, modifier = Modifier.fillMaxWidth(), small = true) { Text("送信を中止", fontSize = 12.sp) }
                }
            }
        }
    }
}

@Composable
private fun MorseKey(label: String, key: String, modifier: Modifier, container: Color = Color(0xFF374151)) {
    Box(
        modifier
            .height(40.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(container)
            .clickable { PochiEngine.morseKey(key) },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (label.length > 1) 11.sp else 15.sp, maxLines = 1)
    }
}
