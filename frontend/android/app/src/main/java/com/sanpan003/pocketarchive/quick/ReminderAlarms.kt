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
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Timed reminders and timed events (2.12.0, hardened in 2.12.1): a local alarm at the due time, so the
 * alert doesn't depend on Google Calendar. Alarms are armed from three places, whichever comes first:
 * the result of a capture (ResultNotifier), the web layer right after a save (plugin), and the server's
 * list (GET /api/reminders/timed, every sync). Alarms live in AlarmManager and the list in prefs, so they
 * fire offline and with the app locked (no text while locked).
 *
 * A local alarm is never cancelled just because the server doesn't list it yet: only an entry the server
 * has listed before ("confirmed") is dropped when it later disappears (done, deleted, undone or moved
 * elsewhere), and Done / delete / undo / a new time cancel it directly.
 */
object ReminderAlarms {
    private const val TAG = "ReminderAlarms"
    private const val PREFS = "timed_reminders"
    private const val KEY_LIST = "list"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_EVENTS = "alertEvents"
    private const val KEY_LOG = "log"
    private const val LOG_MAX = 100
    const val SNOOZE_SHORT_MS = 10 * 60 * 1000L
    const val SNOOZE_LONG_MS = 60 * 60 * 1000L
    private const val LATE_GRACE_MS = 10 * 60 * 1000L // an alarm that fired late (Doze, reboot) is still worth showing
    private val SERVER_ZONE: ZoneId = ZoneId.of("America/New_York") // what the server assumes for a time without an offset

    data class Reminder(
        val id: String, val title: String, val text: String, val dueAt: Long,
        val kind: String = "reminder", val clientId: String? = null, val confirmed: Boolean = false,
    )

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean(KEY_ENABLED, true)
    fun alertEvents(ctx: Context) = prefs(ctx).getBoolean(KEY_EVENTS, true)

    fun setEnabled(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply()
        log(ctx, "settings", null, if (on) "Reminder alerts turned on" else "Reminder alerts turned off")
        if (on) rescheduleAll(ctx) else all(ctx).forEach { cancelAlarm(ctx, it.id) }
    }

    fun setAlertEvents(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_EVENTS, on).apply()
        log(ctx, "settings", null, if (on) "Alert for events turned on" else "Alert for events turned off")
        if (on) ErrandWorker.syncNow(ctx) // pull the events in
        else all(ctx).filter { it.kind == "event" }.forEach { cancel(ctx, it.id, "Alert for events turned off") }
    }

    fun notificationId(id: String) = 5000 + (id.hashCode() and 0xFFFF)

    // ── log (no note text: ids are shortened, reasons are fixed phrases) ──────

    fun log(ctx: Context, event: String, id: String?, why: String, at: Long? = null) {
        runCatching {
            val arr = JSONArray(prefs(ctx).getString(KEY_LOG, "[]"))
            val entry = JSONObject().put("t", System.currentTimeMillis()).put("ev", event).put("why", why)
            if (id != null) entry.put("id", id.takeLast(6))
            if (at != null) entry.put("at", at)
            val next = JSONArray().put(entry)
            for (i in 0 until minOf(arr.length(), LOG_MAX - 1)) next.put(arr.get(i)) // newest first
            prefs(ctx).edit().putString(KEY_LOG, next.toString()).apply()
        }
        Log.i(TAG, "$event ${id?.takeLast(6) ?: ""} $why")
    }

    fun logJson(ctx: Context): JSONArray = runCatching { JSONArray(prefs(ctx).getString(KEY_LOG, "[]")) }.getOrDefault(JSONArray())
    fun clearLog(ctx: Context) = prefs(ctx).edit().remove(KEY_LOG).apply()

    // ── stored list ───────────────────────────────────────────────────────

    fun all(ctx: Context): List<Reminder> = runCatching {
        val arr = JSONArray(prefs(ctx).getString(KEY_LIST, "[]"))
        (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Reminder(
                it.getString("id"), it.optString("title"), it.optString("text"), it.getLong("dueAt"),
                it.optString("kind", "reminder"), it.optString("clientId").takeIf { c -> c.isNotBlank() }, it.optBoolean("confirmed", false),
            )
        }
    }.getOrDefault(emptyList())

    private fun save(ctx: Context, list: List<Reminder>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().put("id", it.id).put("title", it.title).put("text", it.text).put("dueAt", it.dueAt)
                .put("kind", it.kind).put("clientId", it.clientId ?: "").put("confirmed", it.confirmed))
        }
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

    /** Add or replace one reminder / event. [source] is a fixed phrase for the log ("capture result", "saved in the app", "server list"). */
    fun schedule(ctx: Context, r: Reminder, source: String = "saved in the app") {
        val rest = all(ctx).filter { it.id != r.id }
        when {
            alreadyFired(ctx, r) -> return
            r.dueAt < System.currentTimeMillis() - LATE_GRACE_MS -> { save(ctx, rest); cancelAlarm(ctx, r.id); log(ctx, "skipped", r.id, "Due time already passed", r.dueAt); return }
            r.kind == "event" && !alertEvents(ctx) -> { save(ctx, rest); cancelAlarm(ctx, r.id); log(ctx, "skipped", r.id, "Alert for events is off", r.dueAt); return }
        }
        // Keep "confirmed" when the same reminder is saved again
        val previous = all(ctx).firstOrNull { it.id == r.id }
        val entry = r.copy(confirmed = r.confirmed || previous?.confirmed == true)
        save(ctx, rest + entry)
        if (!enabled(ctx)) { log(ctx, "skipped", r.id, "Reminder alerts are off", r.dueAt); return }
        setAlarm(ctx, entry)
        log(ctx, "scheduled", r.id, source + if (canScheduleExact(ctx)) "" else " (approximate: exact alarms not allowed)", r.dueAt)
    }

    /** Done / delete / undo / moved to no time. */
    fun cancel(ctx: Context, id: String, reason: String) {
        val had = all(ctx).any { it.id == id }
        save(ctx, all(ctx).filter { it.id != id })
        cancelAlarm(ctx, id)
        NotificationManagerCompat.from(ctx).cancel(notificationId(id))
        if (had) log(ctx, "cancelled", id, reason)
    }

    /** After a reboot, app update, time or time-zone change: AlarmManager forgot everything. */
    fun rescheduleAll(ctx: Context) {
        val now = System.currentTimeMillis()
        val keep = all(ctx).filter { it.dueAt >= now - LATE_GRACE_MS && !alreadyFired(ctx, it) }
        save(ctx, keep)
        if (!enabled(ctx)) return
        keep.forEach { r -> if (r.dueAt < now) fire(ctx, r.id) else setAlarm(ctx, r) }
        if (keep.isNotEmpty()) log(ctx, "scheduled", null, "Re-armed ${keep.size} after a restart, update or clock change")
    }

    /**
     * The server's list. Entries it has listed before and no longer lists were done, deleted, undone or moved
     * somewhere else → cancel. Entries it has never listed (just created here, upload pending) stay armed.
     */
    fun replaceFromServer(ctx: Context, fresh: List<Reminder>) {
        val now = System.currentTimeMillis()
        val local = all(ctx)
        val freshIds = fresh.map { it.id }.toSet()
        val freshClients = fresh.mapNotNull { it.clientId }.toSet()
        val keptLocal = ArrayList<Reminder>()
        for (l in local) {
            when {
                l.id in freshIds -> {} // replaced below by the server's version
                l.clientId != null && l.clientId in freshClients -> { cancelAlarm(ctx, l.id); log(ctx, "cancelled", l.id, "Replaced by the server's copy of the same note") }
                l.confirmed -> { cancelAlarm(ctx, l.id); log(ctx, "cancelled", l.id, "No longer listed by the server (done, deleted, undone or moved)") }
                else -> keptLocal.add(l) // not uploaded / not yet classified: never cancel on a guess
            }
        }
        val localById = local.associateBy { it.id }
        val merged = ArrayList<Reminder>(keptLocal)
        for (r in fresh) {
            when {
                r.kind == "event" && !alertEvents(ctx) -> cancelAlarm(ctx, r.id)
                alreadyFired(ctx, r) -> localById[r.id]?.let { merged.add(it.copy(confirmed = true)) } // a pending snooze stays as it is
                r.dueAt < now - LATE_GRACE_MS -> {}
                else -> {
                    val before = localById[r.id]
                    merged.add(r.copy(confirmed = true))
                    if (enabled(ctx)) {
                        setAlarm(ctx, r)
                        if (before == null) log(ctx, "scheduled", r.id, "Found in the server's list", r.dueAt)
                        else if (before.dueAt != r.dueAt) log(ctx, "scheduled", r.id, "Time changed", r.dueAt)
                    }
                }
            }
        }
        save(ctx, merged)
    }

    /** Background thread only (network). Offline: re-arm what is stored. */
    fun syncBlocking(ctx: Context) {
        if (TokenStore.apiBase(ctx) == null || TokenStore.token(ctx) == null) return
        val (ok, json) = ErrandSync.requestJson(ctx, "GET", "/api/reminders/timed")
        val arr = json?.optJSONArray("reminders")
        if (ok && arr != null) {
            replaceFromServer(ctx, (0 until arr.length()).map { arr.getJSONObject(it) }.map {
                Reminder(it.getString("id"), it.optString("title"), it.optString("text"), it.getLong("dueAt"),
                    it.optString("kind", "reminder"), it.optString("clientId").takeIf { c -> c.isNotBlank() })
            })
        } else {
            log(ctx, "skipped", null, if (ok) "Server list unavailable; kept what is armed" else "Offline; kept what is armed")
            rescheduleAll(ctx)
        }
    }

    // ── from a note (capture result / web layer) ──────────────────────────

    private fun instant(value: String): Long? = runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(value).atZone(SERVER_ZONE).toInstant().toEpochMilli() }.getOrNull()

    /**
     * Arm (or cancel) the alert for a note JSON as the server returns it. Returns a short phrase for the caller.
     * Reminders: dueDate. Events: start (timed ones only). Location reminders and lists are not timed alerts.
     */
    fun scheduleFromNote(ctx: Context, note: JSONObject, source: String): String {
        val id = note.optString("id").takeIf { it.isNotBlank() } ?: return "no id"
        val type = note.optString("type")
        if (type != "reminder" && type != "event") return "not a reminder"
        val gone = when {
            note.optBoolean("reminderDone") -> "Marked done"
            note.optBoolean("undone") -> "Undone"
            note.optBoolean("hidden") -> "Hidden"
            note.optBoolean("cancelled") -> "Cancelled"
            note.optJSONObject("geo") != null -> "Location reminder"
            note.optString("format") == "list" -> "Checklist"
            note.optString("status") == "pending_decision" -> "Waiting for an answer"
            else -> null
        }
        val whenStr = if (type == "reminder") note.optString("dueDate") else if (note.optBoolean("allDay")) "" else note.optString("start")
        val timed = whenStr.isNotBlank() && whenStr != "null" && !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(whenStr)
        if (gone != null || !timed) {
            cancel(ctx, id, gone ?: "No due time")
            return gone ?: "no time"
        }
        val at = instant(whenStr) ?: run { log(ctx, "skipped", id, "Couldn't read the due time"); return "bad time" }
        val title = note.optString("title")
        schedule(ctx, Reminder(id, title, note.optString("content").ifBlank { title }.take(300), at, type,
            note.optString("clientId").takeIf { it.isNotBlank() }), source)
        return "scheduled"
    }

    // ── firing ────────────────────────────────────────────────────────────

    private fun action(ctx: Context, action: String, id: String): PendingIntent = PendingIntent.getBroadcast(
        ctx, (action + id).hashCode(),
        Intent(ctx, ReminderAlarmReceiver::class.java).setAction(action).putExtra(ReminderAlarmReceiver.EXTRA_ID, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun fire(ctx: Context, id: String) {
        val r = all(ctx).firstOrNull { it.id == id } ?: run { log(ctx, "skipped", id, "Alarm rang but the reminder was gone"); return }
        save(ctx, all(ctx).filter { it.id != id }) // one-shot; Snooze puts it back
        prefs(ctx).edit().putString("fired", fired(ctx).put(id, JSONObject().put("dueAt", r.dueAt).put("title", r.title).put("text", r.text).put("kind", r.kind)).toString()).apply()
        if (!enabled(ctx)) { log(ctx, "skipped", id, "Reminder alerts are off", r.dueAt); return }
        val late = System.currentTimeMillis() - r.dueAt
        show(ctx, r, test = false)
        log(ctx, "fired", id, if (late > 60_000) "Shown ${late / 60_000} min late" else "On time", r.dueAt)
    }

    fun show(ctx: Context, r: Reminder, test: Boolean) {
        Notifications.ensureChannels(ctx)
        // App lock on and locked: "Reminder" only, no note text (also on the lock screen / watch)
        val locked = runCatching { AppLock.isLocked(ctx) }.getOrDefault(false)
        val title = if (locked) "⏰ Reminder" else "⏰ ${r.title}"
        val body = if (locked) "Open Pocket Archive to see it" else r.text.takeIf { it.isNotBlank() && it != r.title } ?: if (r.kind == "event") "Starting now" else "Reminder is due"
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
                if (r.kind != "event") b.addAction(0, "Done", action(ctx, ReminderAlarmReceiver.ACTION_DONE, r.id))
                b.addAction(0, "Snooze 10 min", action(ctx, ReminderAlarmReceiver.ACTION_SNOOZE_10, r.id))
                    .addAction(0, "Snooze 1 h", action(ctx, ReminderAlarmReceiver.ACTION_SNOOZE_60, r.id))
                    .addAction(0, "Open", Notifications.openApp(ctx, "/quick/${r.id}"))
            }
            return b.build()
        }

        if (!Notifications.canPost(ctx)) { Feedback.success(ctx); log(ctx, "skipped", r.id, "Notifications are off for the app"); return }
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

    fun snooze(ctx: Context, id: String, delayMs: Long) {
        val old = all(ctx).firstOrNull { it.id == id }
        val was = fired(ctx).optJSONObject(id)
        val at = System.currentTimeMillis() + delayMs
        schedule(ctx, Reminder(id, old?.title ?: was?.optString("title").orEmpty(), old?.text ?: was?.optString("text").orEmpty(), at,
            old?.kind ?: was?.optString("kind", "reminder") ?: "reminder", old?.clientId, old?.confirmed ?: true), "Snoozed ${delayMs / 60_000} min")
    }

    /** Settings → Test reminder alert: same notification and watch buzz, right now. */
    fun test(ctx: Context): Boolean {
        if (!Notifications.canPost(ctx)) { log(ctx, "skipped", "test", "Test: notifications are off"); return false }
        show(ctx, Reminder("test", "Test reminder", "Timed reminders will look like this.", System.currentTimeMillis()), test = true)
        log(ctx, "fired", "test", "Test alert")
        return true
    }

    // ── status (per note) and health check ────────────────────────────────

    /** { state: set | approx | blocked | off | fired | none, dueAt? } for the line in the note view */
    fun status(ctx: Context, id: String): JSONObject {
        val entry = all(ctx).firstOrNull { it.id == id }
        val out = JSONObject()
        if (entry != null) {
            out.put("dueAt", entry.dueAt)
            return out.put("state", when {
                !enabled(ctx) -> "off"
                !Notifications.canPost(ctx) || Notifications.channelBlocked(ctx, Notifications.CH_REMINDER) -> "blocked"
                !canScheduleExact(ctx) -> "approx"
                else -> "set"
            })
        }
        val f = fired(ctx).optJSONObject(id)
        if (f != null) return out.put("state", "fired").put("dueAt", f.optLong("dueAt"))
        return out.put("state", "none")
    }

    fun ignoringBatteryOptimizations(ctx: Context) =
        ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true

    fun health(ctx: Context): JSONObject {
        val next = all(ctx).minByOrNull { it.dueAt }
        return JSONObject()
            .put("enabled", enabled(ctx))
            .put("alertEvents", alertEvents(ctx))
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
