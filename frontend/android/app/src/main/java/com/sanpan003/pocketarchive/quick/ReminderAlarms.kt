package com.sanpan003.pocketarchive.quick

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.R
import org.json.JSONArray
import org.json.JSONObject

/**
 * Timed reminders (2.12.0): a local alarm at the due time, so the alert doesn't depend on
 * Google Calendar. The list comes from GET /api/reminders/timed (every sync) and from the
 * web layer right after a reminder is saved (also offline). Alarms live in AlarmManager and
 * the list in prefs, so they fire offline and with the app locked (no text while locked).
 */
object ReminderAlarms {
    private const val TAG = "ReminderAlarms"
    private const val PREFS = "timed_reminders"
    private const val KEY_LIST = "list"
    private const val KEY_ENABLED = "enabled"
    const val SNOOZE_SHORT_MS = 10 * 60 * 1000L
    const val SNOOZE_LONG_MS = 60 * 60 * 1000L
    private const val LATE_GRACE_MS = 10 * 60 * 1000L // an alarm that fired late (Doze, reboot) is still worth showing

    data class Reminder(val id: String, val title: String, val text: String, val dueAt: Long)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean(KEY_ENABLED, true)
    fun setEnabled(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply()
        if (on) rescheduleAll(ctx) else all(ctx).forEach { cancelAlarm(ctx, it.id) }
    }

    fun notificationId(id: String) = 5000 + (id.hashCode() and 0xFFFF)

    // ── stored list ───────────────────────────────────────────────────────

    fun all(ctx: Context): List<Reminder> = runCatching {
        val arr = JSONArray(prefs(ctx).getString(KEY_LIST, "[]"))
        (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Reminder(it.getString("id"), it.optString("title"), it.optString("text"), it.getLong("dueAt"))
        }
    }.getOrDefault(emptyList())

    private fun save(ctx: Context, list: List<Reminder>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("id", it.id).put("title", it.title).put("text", it.text).put("dueAt", it.dueAt)) }
        prefs(ctx).edit().putString(KEY_LIST, arr.toString()).apply()
    }

    // Reminders that already fired (id → what fired), so a sync inside the grace window doesn't fire them twice
    // and Snooze can still find the text. Pruned after a day.
    private fun fired(ctx: Context): JSONObject {
        val o = runCatching { JSONObject(prefs(ctx).getString("fired", "{}")) }.getOrDefault(JSONObject())
        val cutoff = System.currentTimeMillis() - 24 * 3600_000L
        o.keys().asSequence().toList().forEach { if (o.getJSONObject(it).optLong("dueAt") < cutoff) o.remove(it) }
        return o
    }
    private fun alreadyFired(ctx: Context, r: Reminder) = fired(ctx).optJSONObject(r.id)?.optLong("dueAt") == r.dueAt

    // ── scheduling ────────────────────────────────────────────────────────

    fun canScheduleExact(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ctx.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true

    private fun alarmIntent(ctx: Context, id: String): PendingIntent = PendingIntent.getBroadcast(
        ctx, id.hashCode(),
        Intent(ctx, ReminderAlarmReceiver::class.java).setAction(ReminderAlarmReceiver.ACTION_FIRE)
            .setData(Uri.parse("pa-reminder://$id")).putExtra(ReminderAlarmReceiver.EXTRA_ID, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun cancelAlarm(ctx: Context, id: String) {
        runCatching { ctx.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(ctx, id)) }
    }

    private fun setAlarm(ctx: Context, r: Reminder) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = alarmIntent(ctx, r.id)
        try {
            if (canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.dueAt, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.dueAt, pi) // permission off: close, not exact
        } catch (e: SecurityException) {
            Log.w(TAG, "Exact alarm refused; using an inexact one", e)
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.dueAt, pi)
        }
    }

    /** Add or replace one reminder (the web layer after save/edit/sync, also offline). */
    fun schedule(ctx: Context, r: Reminder) {
        val rest = all(ctx).filter { it.id != r.id }
        if (alreadyFired(ctx, r) || r.dueAt < System.currentTimeMillis() - LATE_GRACE_MS) { save(ctx, rest); cancelAlarm(ctx, r.id); return }
        save(ctx, rest + r)
        if (enabled(ctx)) setAlarm(ctx, r)
    }

    /** Done / delete / undo / moved to no time. */
    fun cancel(ctx: Context, id: String) {
        save(ctx, all(ctx).filter { it.id != id })
        cancelAlarm(ctx, id)
        NotificationManagerCompat.from(ctx).cancel(notificationId(id))
    }

    /** After a reboot, app update, time or time-zone change: AlarmManager forgot everything. */
    fun rescheduleAll(ctx: Context) {
        val now = System.currentTimeMillis()
        val keep = all(ctx).filter { it.dueAt >= now - LATE_GRACE_MS && !alreadyFired(ctx, it) }
        save(ctx, keep)
        if (!enabled(ctx)) return
        keep.forEach { r -> if (r.dueAt < now) fire(ctx, r.id) else setAlarm(ctx, r) }
    }

    /** The server's list is the truth: drop alarms for reminders that are gone, done or moved. */
    fun replaceFromServer(ctx: Context, fresh: List<Reminder>) {
        val ids = fresh.map { it.id }.toSet()
        all(ctx).filter { it.id !in ids }.forEach { cancelAlarm(ctx, it.id) }
        val now = System.currentTimeMillis()
        val local = all(ctx).associateBy { it.id }
        // Already fired on this phone: the server still lists the old time, so keep a pending snooze as it is
        val keep = fresh.mapNotNull { r -> if (alreadyFired(ctx, r)) local[r.id] else r.takeIf { it.dueAt >= now - LATE_GRACE_MS } }
        save(ctx, keep)
        if (enabled(ctx)) keep.forEach { setAlarm(ctx, it) }
    }

    /** Background thread only (network). Offline: re-arm what is stored. */
    fun syncBlocking(ctx: Context) {
        val apiBase = TokenStore.apiBase(ctx)
        if (apiBase == null || TokenStore.token(ctx) == null) return
        val (ok, json) = ErrandSync.requestJson(ctx, "GET", "/api/reminders/timed")
        val arr = json?.optJSONArray("reminders")
        if (ok && arr != null) {
            replaceFromServer(ctx, (0 until arr.length()).map { arr.getJSONObject(it) }.map {
                Reminder(it.getString("id"), it.optString("title"), it.optString("text"), it.getLong("dueAt"))
            })
        } else rescheduleAll(ctx)
    }

    // ── firing ────────────────────────────────────────────────────────────

    private fun action(ctx: Context, action: String, id: String): PendingIntent = PendingIntent.getBroadcast(
        ctx, (action + id).hashCode(),
        Intent(ctx, ReminderAlarmReceiver::class.java).setAction(action).putExtra(ReminderAlarmReceiver.EXTRA_ID, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun fire(ctx: Context, id: String) {
        val r = all(ctx).firstOrNull { it.id == id } ?: return
        save(ctx, all(ctx).filter { it.id != id }) // one-shot; Snooze puts it back
        prefs(ctx).edit().putString("fired", fired(ctx).put(id, JSONObject().put("dueAt", r.dueAt).put("title", r.title).put("text", r.text)).toString()).apply()
        if (!enabled(ctx)) return
        show(ctx, r, test = false)
    }

    fun show(ctx: Context, r: Reminder, test: Boolean) {
        Notifications.ensureChannels(ctx)
        // App lock on and locked: "Reminder" only, no note text (also on the lock screen / watch)
        val locked = runCatching { AppLock.isLocked(ctx) }.getOrDefault(false)
        val title = if (locked) "⏰ Reminder" else "⏰ ${r.title}"
        val body = if (locked) "Open Pocket Archive to see it" else r.text.takeIf { it.isNotBlank() && it != r.title } ?: "Reminder is due"
        val nid = if (test) Notifications.ID_TEST + 1 else notificationId(r.id)
        val watchApp = WearBridge.watchAppKnown(ctx)

        fun build(localOnly: Boolean, quiet: Boolean): android.app.Notification {
            val b = NotificationCompat.Builder(ctx, Notifications.CH_REMINDER)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setColor(Notifications.AMBER)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body).setBigContentTitle(title))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(
                    NotificationCompat.Builder(ctx, Notifications.CH_REMINDER)
                        .setSmallIcon(R.drawable.ic_stat_mic).setColor(Notifications.AMBER).setContentTitle("⏰ Reminder").build(),
                )
                .setAutoCancel(true)
                .setLocalOnly(localOnly)
                .setOnlyAlertOnce(quiet)
                .setContentIntent(Notifications.openApp(ctx, if (test) "/settings" else "/quick/${r.id}"))
            if (!test) {
                b.addAction(0, "Done", action(ctx, ReminderAlarmReceiver.ACTION_DONE, r.id))
                    .addAction(0, "Snooze 10 min", action(ctx, ReminderAlarmReceiver.ACTION_SNOOZE_10, r.id))
                    .addAction(0, "Snooze 1 h", action(ctx, ReminderAlarmReceiver.ACTION_SNOOZE_60, r.id))
                    .addAction(0, "Open", Notifications.openApp(ctx, "/quick/${r.id}"))
            }
            return b.build()
        }

        if (!Notifications.canPost(ctx)) { Feedback.success(ctx); return }
        try {
            NotificationManagerCompat.from(ctx).notify(nid, build(localOnly = watchApp, quiet = false))
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission missing", e)
        }
        if (watchApp) {
            // The watch app buzzes with its own copy; if it can't be reached, bridge the phone's one normally
            WearBridge.async {
                val e = ErrandStore.Errand(id = r.id, title = r.title, placeName = null, items = emptyList(), branches = emptyList(),
                    kind = "reminder", whenAt = "time", text = body.takeIf { !locked })
                if (!WearBridge.sendArrival(ctx, if (locked) e.copy(title = "Reminder") else e, null, "⏰ Reminder")) {
                    runCatching { NotificationManagerCompat.from(ctx).notify(nid, build(localOnly = false, quiet = true)) }
                }
            }
        }
    }

    fun snooze(ctx: Context, id: String, delayMs: Long, title: String?, text: String?) {
        val old = all(ctx).firstOrNull { it.id == id }
        val was = fired(ctx).optJSONObject(id)
        schedule(ctx, Reminder(id, old?.title ?: was?.optString("title") ?: title.orEmpty(), old?.text ?: was?.optString("text") ?: text.orEmpty(),
            System.currentTimeMillis() + delayMs))
    }

    /** Settings → Test reminder alert: same notification and watch buzz, a few seconds from now. */
    fun test(ctx: Context): Boolean {
        if (!Notifications.canPost(ctx)) return false
        show(ctx, Reminder("test", "Test reminder", "Timed reminders will look like this.", System.currentTimeMillis()), test = true)
        return true
    }

    // ── health check ──────────────────────────────────────────────────────

    fun ignoringBatteryOptimizations(ctx: Context) =
        ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true

    fun health(ctx: Context): JSONObject {
        val next = all(ctx).minByOrNull { it.dueAt }
        return JSONObject()
            .put("enabled", enabled(ctx))
            .put("notifications", Notifications.canPost(ctx))
            .put("channelBlocked", Notifications.channelBlocked(ctx, Notifications.CH_REMINDER))
            .put("exactAlarms", canScheduleExact(ctx))
            .put("batteryUnrestricted", ignoringBatteryOptimizations(ctx))
            .put("scheduled", all(ctx).size)
            .put("nextAt", next?.dueAt)
            .put("manufacturer", Build.MANUFACTURER)
    }

    fun exactAlarmSettingsIntent(ctx: Context): Intent =
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(Uri.parse("package:${ctx.packageName}"))
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:${ctx.packageName}")))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Ask Android to leave the app unrestricted (the dialog); falls back to the app's battery page. */
    fun batteryIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
