package app.pochitalk.rtc

import android.util.Log
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import java.util.concurrent.Executors

/**
 * 通信まわりの状態はすべてこの単一スレッドで触る。
 * ブラウザ版(JavaScript)がシングルスレッドで動く前提で書かれた Trystero / simple-peer の
 * ロジックをそのまま移植しているので、排他制御を入れずに済むようにするための土台。
 * WebRTC / OkHttp のコールバックは別スレッドで来るので、必ず scope.launch で戻してから処理する。
 */
object Runtime {
    private const val TAG = "Pochitalk"

    private val handler = CoroutineExceptionHandler { _, e -> Log.e(TAG, "engine error", e) }

    val dispatcher = Executors.newSingleThreadExecutor { r -> Thread(r, "pochi-engine") }.asCoroutineDispatcher()
    val scope = CoroutineScope(SupervisorJob() + dispatcher + handler)

    /** 通信の記録を端末に残すモードのときだけ設定される。標準は null (保存しない)。 */
    @Volatile var logSink: ((String) -> Unit)? = null

    fun log(msg: String) {
        Log.d(TAG, msg)
        logSink?.invoke(msg)
    }
}
