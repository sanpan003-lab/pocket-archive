package com.sanpan003.pocketarchive.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

object WatchNotifications {
    const val CH_RECORDING = "recording"
    const val CH_RESULT = "result"
    const val CH_ARRIVAL = "arrival"
    const val ID_RECORDING = 1
    const val ID_RESULT = 2

    const val GOLD = 0xFFF59E0B.toInt()
    const val AMBER = 0xFFD97706.toInt()
    const val GREEN = 0xFF10B981.toInt()

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_RECORDING, "Recording", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
            // Buzzes are played by Haptics (double = saved, long = needs review)
            NotificationChannel(CH_RESULT, "Saved notes", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
            },
            NotificationChannel(CH_ARRIVAL, "Arrival reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(true)
                vibrationPattern = Haptics.PATTERN_DOUBLE
            },
        ))
    }

    fun openApp(ctx: Context, requestCode: Int, configure: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getActivity(
            ctx, requestCode,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).apply(configure),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun notify(ctx: Context, id: Int, builder: NotificationCompat.Builder) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, builder.build())
        } catch (e: SecurityException) {
            Log.w("WatchNotifications", "Notifications not allowed", e)
        }
    }
}

/**
 * Shows a server confirmation on the wrist for 4 seconds: in the app when
 * it's on screen, otherwise as a short notification. Double buzz for saved,
 * amber + one long buzz for "needs review".
 */
object ResultPresenter {
    fun show(ctx: Context, conf: JSONObject) {
        val icon = conf.optString("icon").ifBlank { "📝" }
        val text = conf.optString("text").ifBlank { "Voice note saved" }
        val tone = conf.optString("tone", "success")
        val detail = conf.optString("detail").takeIf { it.isNotBlank() && it != "null" }
        val review = tone != "success"
        val captureId = conf.optString("captureId").takeIf { it.isNotBlank() && it != "null" }
        val ask = tone == "ask" && captureId != null
        val undoable = conf.optBoolean("undoable") && captureId != null && !ask

        if (review) Haptics.review(ctx) else Haptics.success(ctx)
        WatchState.set(Phase.Result(icon, text, tone, detail, captureId, ask, undoable))
        if (WatchState.visible) return

        WatchNotifications.ensureChannels(ctx)
        WatchNotifications.notify(ctx, WatchNotifications.ID_RESULT,
            NotificationCompat.Builder(ctx, WatchNotifications.CH_RESULT)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setColor(if (review) WatchNotifications.AMBER else WatchNotifications.GREEN)
                .setContentTitle("$icon $text")
                .setContentText(detail)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setAutoCancel(true)
                .setTimeoutAfter(4_000)
                .setContentIntent(WatchNotifications.openApp(ctx, 10)),
        )
        RecordTileService.requestUpdate(ctx)
    }
}
