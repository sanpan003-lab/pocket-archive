package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Timed reminders: the alarm at the due time, the Done / Snooze buttons on its notification, and
 * re-arming after a reboot, app update, clock / time-zone change or an exact-alarm permission change.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_FIRE = "com.sanpan003.pocketarchive.reminder.FIRE"
        const val ACTION_DONE = "com.sanpan003.pocketarchive.reminder.DONE"
        const val ACTION_SNOOZE_10 = "com.sanpan003.pocketarchive.reminder.SNOOZE_10"
        const val ACTION_SNOOZE_60 = "com.sanpan003.pocketarchive.reminder.SNOOZE_60"
        const val EXTRA_ID = "reminderId"
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID)
        when (intent.action) {
            ACTION_FIRE -> if (id != null) ReminderAlarms.fire(ctx, id)
            ACTION_DONE -> if (id != null) {
                ReminderAlarms.cancel(ctx, id, "Done from the notification")
                ErrandWorker.markDone(ctx, id) // retries until online; the server marks it done
            }
            ACTION_SNOOZE_10, ACTION_SNOOZE_60 -> if (id != null) {
                androidx.core.app.NotificationManagerCompat.from(ctx).cancel(ReminderAlarms.notificationId(id))
                ReminderAlarms.snooze(ctx, id, if (intent.action == ACTION_SNOOZE_10) ReminderAlarms.SNOOZE_SHORT_MS else ReminderAlarms.SNOOZE_LONG_MS)
            }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> ReminderAlarms.rescheduleAll(ctx)
        }
    }
}
