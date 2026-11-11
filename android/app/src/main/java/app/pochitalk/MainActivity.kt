package app.pochitalk

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.UiEvent
import app.pochitalk.ui.Actions
import app.pochitalk.ui.HardKeys
import app.pochitalk.ui.PochiRoot
import app.pochitalk.ui.PochiTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var afterPermissions: (() -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            // 許可されなくても続行する (聞くだけの参加になる。話そうとしたときにまた頼む)
            PochiEngine.refreshMicPermission()
            val next = afterPermissions
            afterPermissions = null
            next?.invoke()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                PochiEngine.events.collect { event ->
                    if (event is UiEvent.RequestMic) withPermissions { }
                }
            }
        }

        val actions = Actions(
            join = { key -> withPermissions { PochiEngine.join(key) } },
            create = { withPermissions { PochiEngine.createRoom() } },
            leave = { PochiEngine.leave() },
            share = { shareInvite() },
            micTest = { on -> if (on) withPermissions { PochiEngine.setMicTest(true) } else PochiEngine.setMicTest(false) },
        )
        setContent {
            PochiTheme {
                val state by PochiEngine.state.collectAsStateWithLifecycle()
                PochiRoot(state, actions)
            }
        }
    }

    // ================================================================ 外付け・Bluetooth キーボード (Web版のキー操作に合わせる)
    // 文字入力欄などが先に処理したキーは、ここへは来ない。リピート (押しっぱなし) は、無視する。

    // 画面の部品より先にキーを見る (Compose のフォーカスがキーを先に食べるのを避ける)。文字入力中は、通常の入力に任せる
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        if (!imm.isAcceptingText) {
            val handled = if (event.action == android.view.KeyEvent.ACTION_DOWN) hardKeyDown(event.keyCode, event) else if (event.action == android.view.KeyEvent.ACTION_UP) hardKeyUp(event.keyCode) else false
            if (handled) return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean = super.onKeyDown(keyCode, event)

    private fun hardKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (event.isCtrlPressed || event.isAltPressed || event.isMetaPressed) return false
        val inRoom = PochiEngine.state.value.currentKey != null
        val drawer = HardKeys.drawerOpen
        val first = event.repeatCount == 0
        when (keyCode) {
            android.view.KeyEvent.KEYCODE_SPACE -> {
                if (!inRoom || drawer) return false
                if (first) PochiEngine.hardSpaceDown()
                return true
            }
            android.view.KeyEvent.KEYCODE_DPAD_UP, android.view.KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (!drawer) return false
                HardKeys.dial.tryEmit(if (keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP) "UP" else "DOWN")
                return true
            }
            android.view.KeyEvent.KEYCODE_ENTER, android.view.KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                if (drawer) { if (first) HardKeys.dial.tryEmit("ENTER"); return true }
                if (inRoom) { if (first) PochiEngine.morseKey("ENTER"); return true }
            }
            android.view.KeyEvent.KEYCODE_ESCAPE -> {
                if (drawer) { if (first) HardKeys.closeDrawer.tryEmit(Unit); return true }
                if (inRoom) { if (first) PochiEngine.morseKey("ESC"); return true }
            }
            android.view.KeyEvent.KEYCODE_TAB -> {
                if (inRoom && !drawer && PochiEngine.state.value.faxMode) { if (first) PochiEngine.morseKey("MODE"); return true }
            }
            android.view.KeyEvent.KEYCODE_DEL -> {
                if (inRoom && !drawer) { if (first) PochiEngine.morseKey("BS"); return true }
            }
            else -> {
                if (inRoom && !drawer) {
                    val ch = event.unicodeChar
                    if (ch > 32 && ch != 127) {
                        if (first) PochiEngine.morseKey(String(Character.toChars(ch)))
                        return true
                    }
                }
            }
        }
        return false
    }

    private fun hardKeyUp(keyCode: Int): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_SPACE) { PochiEngine.hardSpaceUp(); return true }
        return false
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        PochiEngine.onAppForeground()
    }

    override fun onStop() {
        PochiEngine.onAppBackground()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        PochiEngine.refreshMicPermission()
    }

    /** 招待リンク (https://…/?r=ハッシュ または pochitalk://join?r=ハッシュ) を受け取る。自動では入室しない。 */
    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        val key = uri.getQueryParameter("r")?.trim()?.lowercase()
        if (key != null) PochiEngine.setPendingKey(key)
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    /** マイクと通知の許可をまとめて頼んでから action を実行する。 */
    private fun withPermissions(action: () -> Unit) {
        val needed = ArrayList<String>()
        if (!granted(Manifest.permission.RECORD_AUDIO)) needed.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isEmpty()) {
            action()
        } else {
            afterPermissions = action
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun shareInvite() {
        val url = PochiEngine.inviteUrl() ?: return
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "ぽちっと通話で話しましょう: $url")
        startActivity(Intent.createChooser(send, null))
    }
}
