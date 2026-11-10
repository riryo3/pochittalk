package app.pochitalk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pochitalk.core.QrCode
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.formatKey

/** QRボタンの絵 (Web版の qrBtn と同じ: 三つの角の四角と、右下の点)。 */
@Composable
fun QrIcon() {
    Canvas(Modifier.size(22.dp)) {
        val u = size.width / 24f
        val stroke = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f * u)
        for ((x, y) in listOf(3f to 3f, 14f to 3f, 3f to 14f)) {
            drawRoundRect(Color.White, Offset(x * u, y * u), Size(7f * u, 7f * u), CornerRadius(1f * u), style = stroke)
        }
        for ((x, y, w) in listOf(Triple(14f, 14f, 3f), Triple(19f, 14f, 2f), Triple(14f, 19f, 2f), Triple(18f, 18f, 3f))) {
            drawRect(Color.White, Offset(x * u, y * u), Size(w * u, w * u))
        }
    }
}

/** 無線機の裏面 (Web版の .back-face): 招待のQRコード、ルームハッシュ、URL。 */
@Composable
fun QrBackFace(key: String) {
    val url = remember(key) { PochiEngine.inviteUrl() ?: (PochiEngine.INVITE_BASE_URL + "?r=" + key) }
    val qr = remember(url) { runCatching { QrCode.encode(url) }.getOrNull() }
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Text("招待 QR", color = Color(0xFF93C5FD), fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(6.dp))
            Box(Modifier.fillMaxWidth().height(2.dp).background(Color(0xFF374151)))
        }
        // 白いステッカー
        Box(
            Modifier
                .widthIn(max = 250.dp)
                .fillMaxWidth()
                .rotate(-1f)
                .shadow(6.dp, RoundedCornerShape(14.dp))
                .background(Color.White, RoundedCornerShape(14.dp))
                .padding(14.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (qr == null) {
                Text("QRコードを作れませんでした。招待URLの送信をお使いください。", color = Color(0xFF374151), fontSize = 13.sp, textAlign = TextAlign.Center)
            } else {
                Canvas(Modifier.fillMaxWidth().aspectRatio(1f)) {
                    val quiet = 0 // 余白は、白いシールの余白 (14dp) が代わりをする
                    val cell = size.width / (qr.size + quiet * 2)
                    for (y in 0 until qr.size) for (x in 0 until qr.size) {
                        if (qr.get(x, y)) {
                            drawRect(Color.Black, Offset((x + quiet) * cell, (y + quiet) * cell), Size(cell + 0.6f, cell + 0.6f))
                        }
                    }
                }
            }
        }
        Text(formatKey(key), color = Color(0xFF38BDF8), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, letterSpacing = 2.sp)
        Text("このコードを読み取ると、同じ部屋に入れます。", color = PochiColors.Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        androidx.compose.foundation.text.selection.SelectionContainer {
            Text(url, color = PochiColors.Muted.copy(alpha = 0.75f), fontSize = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 12.dp))
        }
    }
}
