package app.pochitalk.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import app.pochitalk.core.Fax

/** 文字列を FAX の絵 (14 行 × 最大 240 列) にする (Web版の textToFaxGrid の移植)。 */
object FaxText {
    fun toGrid(text: String): Array<BooleanArray> {
        val fs = 56f // 大きく描いてから縮小する (小さい字を直接潰すと線が欠けるので)
        val h = 84 // 上下に余裕を持たせ、g のような下へ伸びる字も切らない
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textSize = fs
            color = Color.BLACK
        }
        val w = maxOf(1, Math.ceil(paint.measureText(text).toDouble()).toInt()) + 4
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawText(text, 2f, fs, paint)
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        bmp.recycle()
        fun alpha(x: Int, y: Int) = px[y * w + x] ushr 24
        // インクのある範囲を実測して、その範囲だけを 14 行に写す (字の位置決めをフォント任せにしない)
        var minX = w; var maxX = -1; var minY = h; var maxY = -1
        for (y in 0 until h) for (x in 0 until w) if (alpha(x, y) > 40) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
        val rows = Fax.TEXT_ROWS
        if (maxX < 0) return Array(rows) { BooleanArray(1) }
        val iw = maxX - minX + 1
        val ih = maxY - minY + 1
        val cols = maxOf(1, minOf(Fax.MAX_COLS, Math.round(iw.toDouble() * rows / ih).toInt()))
        return Array(rows) { y ->
            val sy0 = minY + y * ih / rows
            val sy1 = minOf(maxY + 1, maxOf(sy0 + 1, minY + (y + 1) * ih / rows))
            BooleanArray(cols) { x ->
                val sx0 = minX + x * iw / cols
                val sx1 = minOf(maxX + 1, maxOf(sx0 + 1, minX + (x + 1) * iw / cols))
                var ink = 0
                var tot = 0
                for (sy in sy0 until sy1) for (sx in sx0 until sx1) {
                    if (alpha(sx, sy) > 100) ink++
                    tot++
                }
                tot > 0 && ink.toDouble() / tot > 0.2 // 細い線も残す
            }
        }
    }
}
