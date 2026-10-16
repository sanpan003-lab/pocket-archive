package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.R

/**
 * "🛒 You're at Publix — 3 items" with the checklist, plus Open list / Done /
 * Snooze 1 hr. Plain notifications, so a paired Galaxy Watch shows them too.
 */
object ArrivalNotifier {
    private const val TAG = "Errands"
    const val REFIRE_MS = 2 * 60 * 60 * 1000L   // same errand, same store: at most every 2 h
    const val SNOOZE_MS = 60 * 60 * 1000L

    fun notificationId(errandId: String) = 3000 + (errandId.hashCode() and 0xFFFF)

    /** Geofence DWELL (arrive) or EXIT (leave) (key = geofence request id). */
    fun onArrive(ctx: Context, key: String, leaving: Boolean = false) {
        val now = System.currentTimeMillis()
        for (errand in ErrandStore.armed(ctx)) {
            if (errand.leaving != leaving) continue
            val branch = errand.branches.firstOrNull { it.key == key } ?: continue
            if (ErrandStore.snoozedUntil(ctx, errand.id) > now) continue
            if (now - ErrandStore.lastFired(ctx, errand.id, key) < REFIRE_MS) continue
            ErrandStore.setFired(ctx, errand.id, key, now)
            show(ctx, errand, errand.placeName ?: branch.name)
            ErrandWorker.reportTriggered(ctx, errand.id)
        }
    }

    /** "🏠 You're home" / "🚪 Leaving Work" / "📍 You're at the gym" */
    fun reminderHeadline(errand: ErrandStore.Errand, placeName: String?): String {
        val where = placeName ?: "there"
        val home = where.equals("Home", ignoreCase = true)
        return when {
            errand.leaving && home -> "🚪 Leaving home"
            errand.leaving -> "🚪 Leaving $where"
            home -> "🏠 You're home"
            else -> "📍 You're at $where"
        }
    }

    fun show(ctx: Context, errand: ErrandStore.Errand, placeName: String?) {
        Notifications.ensureChannels(ctx)
        val open = errand.openItems
        val where = placeName ?: errand.title
        val title = when {
            errand.isReminder -> "${reminderHeadline(errand, placeName)} — ${errand.title}"
            open.isEmpty() -> "🛒 You're at $where"
            open.size == 1 -> "🛒 You're at $where — 1 item"
            else -> "🛒 You're at $where — ${open.size} items"
        }
        val itemsText = (open.ifEmpty { errand.items }).joinToString("\n") { "${if (it.done) "☑" else "☐"} ${it.text}" }
        val list = if (errand.isReminder) listOfNotNull(errand.text?.takeIf { it != errand.title }, itemsText.ifBlank { null }).joinToString("\n\n").ifBlank { errand.title } else itemsText
        val summary = if (errand.isReminder) (errand.text ?: errand.title) else open.joinToString(", ") { it.text }.ifBlank { errand.title }
        val id = notificationId(errand.id)

        // With the watch app installed, the watch shows its own notification (whose
        // "Open list" opens the watch checklist), so this one stays on the phone.
        // If the watch can't be reached, it's re-posted for normal bridging.
        val watchApp = WearBridge.watchAppKnown(ctx)
        fun build(localOnly: Boolean, quiet: Boolean) = NotificationCompat.Builder(ctx, Notifications.CH_ARRIVAL)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.GREEN)
            .setContentTitle(title)
            .setContentText(summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(list.ifBlank { errand.title }).setBigContentTitle(title))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(ctx, Notifications.CH_ARRIVAL)
                    .setSmallIcon(R.drawable.ic_stat_mic)
                    .setColor(Notifications.GREEN)
                    .setContentTitle(if (errand.isReminder) "📍 Location reminder" else "🛒 Errand list for this store")
                    .build(),
            )
            .setAutoCancel(true)
            .setContentIntent(Notifications.openApp(ctx, "/quick/${errand.id}"))
            .addAction(0, if (errand.isReminder) "Open" else "Open list", Notifications.openApp(ctx, "/quick/${errand.id}"))
            .addAction(0, "Done", action(ctx, ErrandActionReceiver.ACTION_DONE, errand.id, placeName))
            .addAction(0, "Snooze 1 hr", action(ctx, ErrandActionReceiver.ACTION_SNOOZE, errand.id, placeName))
            .setLocalOnly(localOnly)
            .setOnlyAlertOnce(quiet)
            .build()

        if (!Notifications.canPost(ctx)) {
            Feedback.success(ctx) // still buzz twice
            return
        }
        try {
            NotificationManagerCompat.from(ctx).notify(id, build(localOnly = watchApp, quiet = false))
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission missing", e)
        }
        if (watchApp) {
            WearBridge.async {
                if (!WearBridge.sendArrival(ctx, errand, placeName)) {
                    runCatching { NotificationManagerCompat.from(ctx).notify(id, build(localOnly = false, quiet = true)) }
                }
            }
        }
    }

    fun cancel(ctx: Context, errandId: String) =
        NotificationManagerCompat.from(ctx).cancel(notificationId(errandId))

    private fun action(ctx: Context, action: String, errandId: String, place: String?): PendingIntent =
        PendingIntent.getBroadcast(
            ctx,
            (action + errandId).hashCode(),
            Intent(ctx, ErrandActionReceiver::class.java)
                .setAction(action)
                .putExtra(ErrandActionReceiver.EXTRA_ID, errandId)
                .putExtra(ErrandActionReceiver.EXTRA_PLACE, place),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
