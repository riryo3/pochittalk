package app.pochitalk.ui

import kotlinx.coroutines.flow.MutableSharedFlow

/** 外付け・Bluetooth キーボードの操作を、画面側 (ダイヤル・引き出し) へ伝える窓口。 */
object HardKeys {
    /** 部屋の引き出し (ダイヤル) が開いているか。RadioScreen が更新する。 */
    @Volatile var drawerOpen = false
    /** ダイヤルへのキー: "UP" / "DOWN" / "ENTER"。 */
    val dial = MutableSharedFlow<String>(extraBufferCapacity = 16)
    /** 引き出しを閉じる要求。 */
    val closeDrawer = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
}
