package app.pochitalk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pochitalk.engine.RoomInfo
import app.pochitalk.engine.formatKey
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/** おうむ返しボットの部屋 (Web版の BOT_ROOM_KEY)。一覧の先頭に出す。 */
const val BOT_ROOM_KEY = app.pochitalk.engine.PochiEngine.BOT_ROOM_KEY // 定義は 1 か所 (PochiEngine)
private fun isBot(k: String) = app.pochitalk.engine.isBotRoom(k)
private const val MAX_ROOM = 8
private val BotGreen = Color(0xFF34D399)

// Web版の部屋ダイヤルと同じ寸法・円柱のモデル。1行の高さ132dp、上下の端を含めて5部屋が見える。
private val ROW = 132.dp
private const val STEP_DEG = 36.0 // 1行あたりの回転角

/**
 * 部屋を探すダイヤル (Web版の .rdial)。部屋は円柱の表面に並び、中央の1行が真正面を向く。
 * 上下に回し、見えている部屋をタップすると入る (赤い線の部屋以外は、入りながらそこまで回る)。
 */
@Composable
fun RoomDial(rooms: List<RoomInfo>, connected: Int, pendingKey: String?, emptyText: String, onJoin: (String) -> Unit, onCenter: (String?) -> Unit = {}) {
    val density = LocalDensity.current
    val rowPx = with(density) { ROW.toPx() }
    val radius = rowPx / (STEP_DEG * PI / 180.0).toFloat()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    // 回転量 (行数)。先頭の部屋が真ん中に来ているときが 0
    val scrollRows by remember { derivedStateOf { (listState.firstVisibleItemIndex * rowPx + listState.firstVisibleItemScrollOffset) / rowPx } }
    val centerIdx by remember { derivedStateOf { scrollRows.roundToInt().coerceIn(0, max(0, rooms.size - 1)) } }

    // 一覧が作り直されても、同じ部屋が赤い線の位置に残るようにする (初回は、いまいる部屋、なければ先頭)
    var anchor by remember { mutableStateOf<String?>(null) }
    // 指で回すまでは、いちばん良い初期位置 (いまいる部屋 > 招待 > おうむ返し > 先頭) に合わせ続ける。
    // 一覧は少しずつ届くので、あとから届いたおうむ返しの部屋にも合わせられる。回したあとは、同じ部屋を赤い線に残す。
    var userMoved by remember { mutableStateOf(false) }
    LaunchedEffect(listState) {
        listState.interactionSource.interactions.collect { if (it is androidx.compose.foundation.interaction.DragInteraction.Start) userMoved = true }
    }
    // 入室した (いる部屋が変わった) 瞬間に、その部屋が赤い線まで回る。以後、指で回したら、その位置を保つ
    val currentKey = rooms.firstOrNull { it.isCurrent }?.key
    val latestRooms by rememberUpdatedState(rooms)
    LaunchedEffect(currentKey) {
        if (currentKey == null) return@LaunchedEffect
        userMoved = false
        val at = latestRooms.indexOfFirst { it.key == currentKey }
        if (at >= 0 && at != centerIdx) listState.animateScrollToItem(at)
        anchor = currentKey
    }
    LaunchedEffect(rooms.map { it.key }) {
        if (rooms.isEmpty()) return@LaunchedEffect
        val keys = rooms.map { it.key }
        val preferred = rooms.indexOfFirst { it.isCurrent }.takeIf { it >= 0 }
            ?: rooms.indexOfFirst { it.key == pendingKey }.takeIf { it >= 0 } // 招待された部屋
            ?: max(0, rooms.indexOfFirst { it.key == BOT_ROOM_KEY }) // 指定が無ければ、おうむ返しの部屋 (新しい番号)
        val target = if (userMoved) anchor?.let { keys.indexOf(it) }?.takeIf { it >= 0 } ?: preferred else preferred
        if (!listState.isScrollInProgress) listState.scrollToItem(target)
    }
    // 赤い線に合っている部屋を、上に知らせる (入室していないとき、本体の表示部分に出す)
    LaunchedEffect(centerIdx, rooms.map { it.key }) { onCenter(rooms.getOrNull(centerIdx)?.key) }
    LaunchedEffect(listState.isScrollInProgress, centerIdx) {
        if (!listState.isScrollInProgress) anchor = rooms.getOrNull(centerIdx)?.key
    }

    Box(
        Modifier
            .fillMaxWidth()
            .height(ROW * 3)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF0F1419))
            .border(1.dp, Color(0xFF2D3748), RoundedCornerShape(14.dp)),
    ) {
        // 円柱の側面を横切る細い線 (回すと流れ、上下ほど詰まる)
        Canvas(Modifier.fillMaxSize()) {
            val rot = scrollRows * STEP_DEG
            val cy = size.height / 2
            for (k in 0 until 36) {
                val rel = (((k * 10.0 - rot) % 360 + 540) % 360) - 180
                if (abs(rel) > 86) continue
                val rr = rel * PI / 180
                val a = (0.12 + 0.88 * (1 - cos(rr))) * 0.16
                val y = cy + radius * sin(rr).toFloat()
                drawLine(Color(0xFF94A3B8).copy(alpha = a.toFloat()), Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
            }
        }
        if (rooms.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text(emptyText, color = PochiColors.Muted, fontSize = 13.sp)
            }
        } else {
            LazyColumn(
                state = listState,
                flingBehavior = rememberSnapFlingBehavior(listState),
                contentPadding = PaddingValues(vertical = ROW),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(rooms, key = { _, r -> r.key }) { i, room ->
                    DialItem(
                        room = room,
                        connected = connected,
                        pending = room.key == pendingKey,
                        onLine = i == centerIdx,
                        modifier = Modifier.graphicsLayer {
                            val off = i - scrollRows
                            val th = max(-88.0, min(88.0, off * STEP_DEG))
                            val rad = th * PI / 180
                            val c = cos(rad)
                            translationY = (radius * sin(rad) - off * rowPx).toFloat()
                            scaleY = max(0.04, c).toFloat()
                            alpha = if (abs(off) > 2.6) 0f else max(0.12, c.pow(1.1)).toFloat()
                        },
                        onClick = {
                            // 赤い線の部屋は、そのまま入る。ほかの行も、タップしたらその部屋に入る (回してからもう一度押さなくてよい)
                            if (i != centerIdx) scope.launch { listState.animateScrollToItem(i) }
                            onJoin(room.key)
                        },
                    )
                }
            }
        }
        // 赤い線 (1行目と2行目のすきまを通る)
        Canvas(Modifier.fillMaxSize()) {
            val y = size.height / 2
            val x0 = 6.dp.toPx()
            val x1 = size.width - 6.dp.toPx()
            drawLine(PochiColors.Tx.copy(alpha = 0.22f), Offset(x0, y), Offset(x1, y), 8.dp.toPx())
            drawLine(PochiColors.Tx, Offset(x0, y), Offset(x1, y), 2.dp.toPx())
            val t = 5.dp.toPx()
            val left = Path().apply { moveTo(x0 - 2.dp.toPx(), y - t); lineTo(x0 - 2.dp.toPx() + t * 2, y); lineTo(x0 - 2.dp.toPx(), y + t); close() }
            val right = Path().apply { moveTo(x1 + 2.dp.toPx(), y - t); lineTo(x1 + 2.dp.toPx() - t * 2, y); lineTo(x1 + 2.dp.toPx(), y + t); close() }
            drawPath(left, PochiColors.Tx)
            drawPath(right, PochiColors.Tx)
        }
        // 両端の目盛りの溝
        Canvas(Modifier.fillMaxSize()) {
            val rot = scrollRows * STEP_DEG
            val cy = size.height / 2
            val railW = 13.dp.toPx()
            drawRect(Brush.horizontalGradient(listOf(Color.White.copy(alpha = 0.07f), Color.Transparent), 0f, railW), size = androidx.compose.ui.geometry.Size(railW, size.height))
            drawRect(
                Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.07f)), size.width - railW, size.width),
                topLeft = Offset(size.width - railW, 0f),
                size = androidx.compose.ui.geometry.Size(railW, size.height),
            )
            for (k in 0 until 30) {
                val rel = (((k * 12.0 - rot) % 360 + 540) % 360) - 180
                if (abs(rel) > 86) continue
                val rr = rel * PI / 180
                val a = (0.2 + 0.8 * cos(rr)).toFloat() * 0.6f
                val y = cy + radius * sin(rr).toFloat()
                val col = Color(0xFFCBD5E1).copy(alpha = a)
                drawLine(col, Offset(2.dp.toPx(), y), Offset(railW - 2.dp.toPx(), y), 2.dp.toPx())
                drawLine(col, Offset(size.width - railW + 2.dp.toPx(), y), Offset(size.width - 2.dp.toPx(), y), 2.dp.toPx())
            }
        }
        // 上下の暗がり
        Box(
            Modifier.fillMaxWidth().fillMaxSize(0.34f).background(Brush.verticalGradient(listOf(Color(0xFF0F1419), Color.Transparent))),
        )
        Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.BottomCenter) {
            Box(
                Modifier.fillMaxWidth().fillMaxSize(0.34f).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xFF0F1419)))),
            )
        }
    }
}

@Composable
private fun DialItem(room: RoomInfo, connected: Int, pending: Boolean, onLine: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val full = room.count >= MAX_ROOM && !room.isCurrent
    val edge = when {
        room.air -> PochiColors.Tx
        pending -> PochiColors.Amber
        isBot(room.key) -> BotGreen
        else -> Color.Transparent
    }
    val bg = when {
        room.isCurrent -> Color(0xFF172554).copy(alpha = 0.55f)
        onLine -> Color(0xFF3B82F6).copy(alpha = 0.10f)
        else -> Color.Transparent
    }
    Row(
        modifier
            .fillMaxWidth()
            .height(ROW)
            .graphicsLayer { if (full) alpha *= 0.6f }
            .background(bg)
            .clickable(onClick = onClick),
    ) {
        // 左の細い帯 (3dp): ボット=緑、招待=黄、送信中=赤
        Box(Modifier.width(3.dp).fillMaxHeight().background(edge))
        Column(Modifier.padding(start = 13.dp, end = 16.dp, top = 20.dp)) {
            val head = (if (isBot(room.key)) "🦜 " else "") + (if (room.air) "🔴 " else "🔵 ") + formatKey(room.key) + " · 👤${room.count}" +
                (if (room.isCurrent && room.count != connected) "（つながっているのは ${connected} 人）" else "") +
                (if (room.count >= MAX_ROOM) " · 満員" else "") + (if (pending) " · 招待" else "")
            Text(head, color = PochiColors.Text, fontFamily = FontFamily.Monospace, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.height(26.dp))
            Spacer(Modifier.height(1.dp))
            ElapsedLine(room, 15.dp, 11.sp) // ID の行のすぐ下 (赤い線の上)
            Spacer(Modifier.height(9.dp)) // 赤い線(行の真ん中=66dp)は、時刻の行とタグ(72dpから)のすきまを通る
            if (room.tag.isNotEmpty()) {
                Text(
                    "🏷 " + room.tag + (if (room.tagBy.isNotEmpty()) "（${room.tagBy}）" else ""),
                    color = Color(0xFF93C5FD), fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            val who = when {
                room.invited -> "招待された部屋（現在は無人）"
                room.count == 0 && room.names.isEmpty() -> "この部屋には、いま誰もいません"
                else -> room.names.joinToString("、")
            }
            Text(who, color = PochiColors.Muted, fontSize = 12.sp, lineHeight = 16.sp) // 全員の名前を省略せず、「、」で折り返す
        }
    }
}

/** 「⏱ 開いてから ◯分」の1行 (15秒ごとに更新)。おうむの部屋は時刻を持たず「♾ 常設」。無人は空欄 (高さは確保)。 */
@Composable
fun ElapsedLine(room: RoomInfo?, height: androidx.compose.ui.unit.Dp, size: androidx.compose.ui.unit.TextUnit, modifier: Modifier = Modifier) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(15_000); now = System.currentTimeMillis() } }
    val text = when {
        room == null -> ""
        isBot(room.key) -> "♾ 常設"
        room.openAt > 0 -> "⏱ 開いてから " + app.pochitalk.engine.fmtElapsed(now - room.openAt)
        else -> ""
    }
    Text(text, color = PochiColors.Muted, fontSize = size, lineHeight = size, maxLines = 1, modifier = modifier.height(height))
}
