package com.sanpan003.pocketarchive.quick

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.MainActivity

object Notifications {
    const val CH_RECORDING = "recording"
    const val CH_RESULT_OK = "result_saved"          // double buzz
    const val CH_RESULT_REVIEW = "result_review"     // single long buzz
    const val CH_RESULT_SILENT = "result_silent"     // "Sound & vibration" off

    const val ID_RECORDING = 1001
    const val ID_RESULT = 1002

    const val GOLD = 0xFFF59E0B.toInt()
    const val GREEN = 0xFF10B981.toInt()
    const val AMBER = 0xFFD97706.toInt()
    const val GREY = 0xFF64748B.toInt()

    val PATTERN_OK = longArrayOf(0, 60, 40, 60)
    val PATTERN_REVIEW = longArrayOf(0, 300)

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_RECORDING, "Recording", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Quick Capture is recording"
                setShowBadge(false)
            },
            NotificationChannel(CH_RESULT_OK, "Saved notes", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Confirmation after a voice note is saved"
                setSound(null, null)
                enableVibration(true)
                vibrationPattern = PATTERN_OK
            },
            NotificationChannel(CH_RESULT_REVIEW, "Needs attention", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "A voice note needs review, is queued, or couldn't be saved"
                setSound(null, null)
                enableVibration(true)
                vibrationPattern = PATTERN_REVIEW
            },
            NotificationChannel(CH_RESULT_SILENT, "Saved notes (silent)", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Confirmations when Sound & vibration is turned off in the app"
                setSound(null, null)
                enableVibration(false)
            },
        ))
    }

    fun canPost(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** Opens the app at a route, e.g. "/quick/inbox". */
    fun openApp(ctx: Context, route: String): PendingIntent =
        PendingIntent.getActivity(
            ctx,
            route.hashCode(),
            Intent(ctx, MainActivity::class.java)
                .setAction(QuickActions.ACTION_OPEN_ROUTE)
                .putExtra(QuickActions.EXTRA_ROUTE, route)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
