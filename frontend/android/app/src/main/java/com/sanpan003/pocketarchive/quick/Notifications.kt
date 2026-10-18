package com.sanpan003.pocketarchive.quick

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.sanpan003.pocketarchive.MainActivity
import com.sanpan003.pocketarchive.R
import org.json.JSONArray
import org.json.JSONObject

object Notifications {
    const val CH_RECORDING = "recording"
    const val CH_RESULT_OK = "result_saved"          // double buzz
    const val CH_RESULT_REVIEW = "result_review"     // single long buzz
    const val CH_RESULT_SILENT = "result_silent"     // "Sound & vibration" off
    const val CH_ARRIVAL = "errand_arrival"          // "You're at Publix" — double buzz
    const val CH_SHARED = "shared_changes"           // "Jane added Eggs" (shared lists, background check)

    const val ID_RECORDING = 1001
    const val ID_RESULT = 1002
    const val ID_TEST = 1003

    const val BRAND = 0xFF6366F1.toInt() // Purple Neon Bolt (app icon)
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
            NotificationChannel(CH_ARRIVAL, "Arrival reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Location reminders (arrive / leave a place) and your errand list at a store"
                setSound(null, null)
                enableVibration(true)
                vibrationPattern = PATTERN_OK
            },
            NotificationChannel(CH_SHARED, "Shared lists", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Changes other people make to lists and notes you share"
            },
            NotificationChannel(CH_RESULT_SILENT, "Saved notes (silent)", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Confirmations when Sound & vibration is turned off in the app"
                setSound(null, null)
                enableVibration(false)
            },
        ))
    }

    fun canPost(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** Settings → Notifications: app-level switch + every channel (blocked = importance NONE). */
    fun status(ctx: Context): JSONObject {
        ensureChannels(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val channels = JSONArray()
        nm?.notificationChannels?.sortedBy { it.name.toString() }?.forEach { ch ->
            channels.put(JSONObject().put("id", ch.id).put("name", ch.name.toString()).put("description", ch.description)
                .put("importance", ch.importance).put("blocked", ch.importance == NotificationManager.IMPORTANCE_NONE))
        }
        return JSONObject()
            .put("enabled", canPost(ctx))
            .put("permission", if (Build.VERSION.SDK_INT < 33) "granted"
                else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) "granted" else "denied")
            .put("channels", channels)
            .put("watchApp", WearBridge.watchAppKnown(ctx))
    }

    /** "Send test notification": phone = this phone only; watch = through the watch app (or normal bridging). */
    fun sendTest(ctx: Context, target: String): Boolean {
        ensureChannels(ctx)
        if (!canPost(ctx)) return false
        val toWatch = target == "watch"
        val n = NotificationCompat.Builder(ctx, CH_ARRIVAL)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(GREEN)
            .setContentTitle(if (toWatch) "⌚ Test notification for your watch" else "🔔 Test notification")
            .setContentText("Location reminders will look like this.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, "/settings#notifications"))
            .setLocalOnly(!toWatch || WearBridge.watchAppKnown(ctx))
            .build()
        return try {
            NotificationManagerCompat.from(ctx).notify(ID_TEST, n)
            if (toWatch && WearBridge.watchAppKnown(ctx)) {
                // The watch app shows its own copy (same path as a real location reminder)
                val test = ErrandStore.Errand(id = "test", title = "Test notification", placeName = "Test",
                    items = emptyList(), branches = emptyList(), kind = "reminder", whenAt = "arrive", text = "Location reminders will look like this.")
                WearBridge.async { WearBridge.sendArrival(ctx, test, "Test") }
            }
            true
        } catch (e: SecurityException) {
            false
        }
    }

    /** App notification settings, or one channel's settings. */
    fun settingsIntent(ctx: Context, channelId: String?): Intent =
        (if (channelId != null) Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
        else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS))
            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

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
