package app.pochitalk.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import app.pochitalk.MainActivity
import app.pochitalk.R
import app.pochitalk.engine.PochiEngine
import app.pochitalk.engine.formatKey

/**
 * 部屋に入っている間、画面を消したりほかのアプリに切り替えたりしても通話を続けるための
 * フォアグラウンドサービス (種別: microphone)。通話の本体は PochiEngine にあり、
 * ここはプロセスを生かしておく役と、通知の「退出」ボタンを受ける役だけ。
 */
class CallService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var mediaSession: android.media.session.MediaSession? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_LEAVE) {
            PochiEngine.leave()
            stopSelf()
            return START_NOT_STICKY
        }
        val key = intent?.getStringExtra(EXTRA_KEY).orEmpty()
        createChannel()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(key),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pochitalk:call").apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_MAX_MS)
            }
        }
        startMediaSession()
        isRunning = true
        return START_NOT_STICKY
    }

    /** メディアボタン (イヤホンのボタンなど) を、入室中だけ受ける。画面が消えていても、このサービスが生きている間は届く。 */
    private fun startMediaSession() {
        if (mediaSession != null) return
        val s = android.media.session.MediaSession(this, "pochitalk")
        s.setCallback(object : android.media.session.MediaSession.Callback() {
            override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                if (!PochiEngine.mediaBtnOn) return false
                @Suppress("DEPRECATION")
                val ev = mediaButtonIntent.getParcelableExtra<android.view.KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
                when (ev.keyCode) {
                    android.view.KeyEvent.KEYCODE_HEADSETHOOK, android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                    android.view.KeyEvent.KEYCODE_MEDIA_PLAY, android.view.KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                        if (ev.action == android.view.KeyEvent.ACTION_DOWN && ev.repeatCount == 0) PochiEngine.mediaKeyDown()
                        else if (ev.action == android.view.KeyEvent.ACTION_UP) PochiEngine.mediaKeyUp()
                        return true
                    }
                }
                return false
            }
        })
        s.setMetadata(android.media.MediaMetadata.Builder().putString(android.media.MediaMetadata.METADATA_KEY_TITLE, getString(R.string.app_name)).build())
        val actions = android.media.session.PlaybackState.ACTION_PLAY or android.media.session.PlaybackState.ACTION_PAUSE or android.media.session.PlaybackState.ACTION_PLAY_PAUSE
        s.setPlaybackState(
            android.media.session.PlaybackState.Builder().setActions(actions)
                .setState(android.media.session.PlaybackState.STATE_PLAYING, 0L, 1f).build(),
        )
        s.isActive = true
        mediaSession = s
    }

    override fun onDestroy() {
        mediaSession?.let { it.isActive = false; it.release() }
        mediaSession = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        isRunning = false
        super.onDestroy()
    }

    private fun createChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun buildNotification(key: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val leave = PendingIntent.getService(
            this, 1, Intent(this, CallService::class.java).setAction(ACTION_LEAVE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val room = if (key.length == 8) formatKey(key) else ""
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_radio)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text, room))
            .setContentIntent(open)
            .addAction(0, getString(R.string.leave), leave)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "call"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_LEAVE = "app.pochitalk.LEAVE"
        private const val EXTRA_KEY = "key"
        private const val WAKE_LOCK_MAX_MS = 4 * 60 * 60 * 1000L

        @Volatile var isRunning: Boolean = false
            private set

        fun start(context: Context, key: String) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CallService::class.java).putExtra(EXTRA_KEY, key),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallService::class.java))
        }
    }
}
