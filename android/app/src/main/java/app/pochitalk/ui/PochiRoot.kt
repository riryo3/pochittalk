package app.pochitalk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.pochitalk.engine.UiState

/** UI から Activity (権限・共有) を呼ぶための窓口。 */
class Actions(
    val join: (String) -> Unit,
    val create: () -> Unit,
    val leave: () -> Unit,
    val share: () -> Unit,
    /** マイクテストの開始/停止 (開始時はマイク権限を確認する)。 */
    val micTest: (Boolean) -> Unit,
)

/** 画面の土台。ロビーはホーム画面、入室後は無線機画面 (部屋一覧は、どちらもWeb版と同じく下に並べる)。 */
@Composable
fun PochiRoot(state: UiState, actions: Actions) {
    Box(
        Modifier
            .fillMaxSize()
            .background(PochiColors.Bg)
            .safeDrawingPadding(),
    ) {
        // Web版と同じ1画面: 入室前も無線機を出し、大きなボタンが NEW / JOIN / 話す に変わる
        RadioScreen(state, actions, onOpenRooms = {}, modifier = Modifier.fillMaxSize())
    }
}
