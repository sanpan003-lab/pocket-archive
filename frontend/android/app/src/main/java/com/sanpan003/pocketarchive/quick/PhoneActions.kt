package com.sanpan003.pocketarchive.quick

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.sanpan003.pocketarchive.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Phone actions from quick notes (the server classifies; the phone does it):
 *  alarm / timer   → the Clock app (AlarmClock intents, no UI; Samsung Clock syncs alarms to the watch)
 *  navigate        → Google Maps directions
 *  message / call  → Messages / the dialer, PREFILLED — never sent or dialed automatically
 *  dnd             → Do Not Disturb (needs Notification Policy access), restored after the duration
 *  flashlight      → the camera torch
 *  openApp         → launches the installed app whose name matches
 * Several contacts / apps match → "Choose" (Quick Capture → Actions). Every run is reported to the server.
 *
 * Android only lets an app open another app from the background when it's on screen or has
 * "Display over other apps"; otherwise the action becomes a notification you tap (full-screen when locked).
 */
object PhoneActions {
    private const val TAG = "PhoneActions"
    private const val ID_ACTION = 1011
    private const val PREFS = "phone_actions"
    const val DAY_CODES = "MO,TU,WE,TH,FR,SA,SU"

    // ── Outcome ────────────────────────────────────────────────────────────
    /** { status: done|tap|failed|needs_choice|needs_permission, icon, text, detail?, undo } */
    private fun outcome(status: String, icon: String, text: String, detail: String? = null, undo: Boolean = false) =
        JSONObject().put("status", status).put("icon", icon).put("text", text).put("undo", undo).apply { if (detail != null) put("detail", detail) }

    private fun clock(h: Int, m: Int) = "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"

    private fun durationText(sec: Int): String = when {
        sec < 60 -> "$sec s"
        sec % 3600 == 0 -> "${sec / 3600} hr"
        sec >= 3600 -> "${sec / 3600} hr ${(sec % 3600) / 60} min"
        sec % 60 == 0 -> "${sec / 60} min"
        else -> "${sec / 60} min ${sec % 60} s"
    }

    private fun repeatText(days: List<String>): String? = when {
        days.isEmpty() -> null
        days.size == 7 -> "Every day"
        days.size == 5 && days.containsAll(listOf("MO", "TU", "WE", "TH", "FR")) -> "Weekdays"
        days.size == 2 && days.containsAll(listOf("SA", "SU")) -> "Weekends"
        else -> days.joinToString(", ") { mapOf("MO" to "Mon", "TU" to "Tue", "WE" to "Wed", "TH" to "Thu", "FR" to "Fri", "SA" to "Sat", "SU" to "Sun")[it] ?: it }
    }

    private fun days(a: JSONObject): List<String> = a.optJSONArray("repeat")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()

    // ── Run ────────────────────────────────────────────────────────────────

    /** Run [a] (from the capture response or the Actions page). [choice]: a picked contact { number } / app { package }. */
    fun run(ctx: Context, a: JSONObject, choice: JSONObject? = null): JSONObject {
        val out = try {
            when (a.optString("kind")) {
                "alarm" -> alarm(ctx, a)
                "timer" -> timer(ctx, a)
                "navigate" -> navigate(ctx, a)
                "message" -> messageOrCall(ctx, a, choice, call = false)
                "call" -> messageOrCall(ctx, a, choice, call = true)
                "dnd" -> dnd(ctx, a)
                "flashlight" -> flashlight(ctx, a.optBoolean("on", true))
                "openApp" -> openApp(ctx, a, choice)
                else -> outcome("failed", "⚠️", "Unknown action")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Action failed", e)
            outcome("failed", "⚠️", "Couldn't do that", e.message)
        }
        report(ctx, a.optString("id"), out.optString("status"), "${out.optString("icon")} ${out.optString("text")}".trim(), out.optString("detail").takeIf { it.isNotBlank() })
        return out
    }

    private fun alarm(ctx: Context, a: JSONObject): JSONObject {
        val h = a.optInt("hour"); val m = a.optInt("minute")
        val label = a.optString("label").takeIf { it.isNotBlank() }
        val repeat = days(a)
        val calDays = repeat.mapNotNull { mapOf("MO" to Calendar.MONDAY, "TU" to Calendar.TUESDAY, "WE" to Calendar.WEDNESDAY, "TH" to Calendar.THURSDAY, "FR" to Calendar.FRIDAY, "SA" to Calendar.SATURDAY, "SU" to Calendar.SUNDAY)[it] }
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, h)
            .putExtra(AlarmClock.EXTRA_MINUTES, m)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            .apply {
                if (label != null) putExtra(AlarmClock.EXTRA_MESSAGE, label)
                if (calDays.isNotEmpty()) putExtra(AlarmClock.EXTRA_DAYS, ArrayList(calDays))
            }
        Log.i(TAG, "SET_ALARM hour=$h minute=$m label=${label ?: ""} days=${calDays.joinToString(",")} to=${toClock(ctx, intent).`package` ?: "default"}")
        val what = listOfNotNull("Alarm", clock(h, m), repeatText(repeat), label).joinToString(" · ")
        return launch(ctx, toClock(ctx, intent), a, "⏰", "$what set", "Tap to set: $what",
            undoDetail = "Undo opens Clock's alarm list so you can delete it", undo = true)
    }

    private fun timer(ctx: Context, a: JSONObject): JSONObject {
        val sec = a.optInt("seconds")
        val label = a.optString("label").takeIf { it.isNotBlank() }
        val intent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, sec)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            .apply { if (label != null) putExtra(AlarmClock.EXTRA_MESSAGE, label) }
        Log.i(TAG, "SET_TIMER seconds=$sec label=${label ?: ""} to=${toClock(ctx, intent).`package` ?: "default"}")
        val what = listOfNotNull("Timer ${durationText(sec)}", label).joinToString(" · ")
        return launch(ctx, toClock(ctx, intent), a, "⏲", what, "Tap to start: $what", undoDetail = "Undo opens Clock's timers so you can stop it", undo = true)
    }

    private fun navigate(ctx: Context, a: JSONObject): JSONObject {
        val dest = a.optJSONObject("destination")
        val name = dest?.optString("name")?.takeIf { it.isNotBlank() } ?: a.optString("place")
        val q = if (dest != null && dest.has("lat") && !dest.isNull("lat")) "${dest.optDouble("lat")},${dest.optDouble("lng")}"
            else dest?.optString("address")?.takeIf { it.isNotBlank() } ?: a.optString("place")
        val maps = "com.google.android.apps.maps"
        val intent = if (installed(ctx, maps)) Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=${Uri.encode(q)}")).setPackage(maps)
            else Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=${Uri.encode(q)}"))
        return launch(ctx, intent, a, "📍", "Directions to $name", "Tap for directions to $name")
    }

    private fun messageOrCall(ctx: Context, a: JSONObject, choice: JSONObject?, call: Boolean): JSONObject {
        val to = a.optString("to")
        val icon = if (call) "📞" else "💬"
        val number = choice?.optString("number")?.takeIf { it.isNotBlank() }
            ?: to.takeIf { it.count(Char::isDigit) >= 3 && it.all { c -> c.isDigit() || c in "+-() ." } }
        val who = choice?.optString("label")?.takeIf { it.isNotBlank() } ?: to
        val resolved = number ?: run {
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                askInApp(ctx, a, icon, "Allow contacts to ${if (call) "call" else "message"} $to", "Pocket Archive asks once to read contacts")
                return outcome("needs_permission", icon, "Allow contacts to ${if (call) "call" else "message"} $to", "Tap the notification or open Quick Capture → Actions")
            }
            val matches = contacts(ctx, to)
            when {
                matches.isEmpty() -> return outcome("failed", icon, "No contact called “$to”")
                matches.size > 1 -> {
                    askInApp(ctx, a, icon, "Which $to?", "${matches.size} contacts match — tap to choose")
                    return outcome("needs_choice", icon, "Which $to? ${matches.size} contacts match", "Tap to choose")
                }
                else -> matches[0].optString("number")
            }
        }
        val name = if (number == null) contacts(ctx, to).firstOrNull()?.optString("label") ?: to else who
        val intent = if (call) Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(resolved)}"))
            else Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(resolved)}")).putExtra("sms_body", a.optString("text"))
        return if (call) launch(ctx, intent, a, icon, "Ready to call $name — tap Call", "Tap to call $name")
            else launch(ctx, intent, a, icon, "Message to $name ready — tap Send", "Tap to message $name")
    }

    private fun dnd(ctx: Context, a: JSONObject): JSONObject {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) {
            val open = PendingIntent.getActivity(ctx, 41, Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
            post(ctx, "🔕 Allow Do Not Disturb access", "Then say it again — Pocket Archive → Allow", open)
            return outcome("needs_permission", "🔕", "Allow Do Not Disturb access first", "Settings → Alarms & phone actions")
        }
        val on = a.optBoolean("on", true)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (on) {
            if (nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_PRIORITY) prefs.edit().putInt("dndBefore", nm.currentInterruptionFilter).apply()
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
            val minutes = a.optInt("durationMinutes")
            if (minutes > 0) {
                val at = System.currentTimeMillis() + minutes * 60_000L
                ctx.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, restoreIntent(ctx))
                prefs.edit().putLong("dndUntil", at).apply()
                val c = Calendar.getInstance().apply { timeInMillis = at }
                return outcome("done", "🔕", "Do Not Disturb on until ${clock(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))}", undo = true)
            }
            return outcome("done", "🔕", "Do Not Disturb on", undo = true)
        }
        restoreDnd(ctx)
        return outcome("done", "🔕", "Do Not Disturb off")
    }

    private fun restoreIntent(ctx: Context) = PendingIntent.getBroadcast(ctx, 42, Intent(ctx, DndRestoreReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Back to how it was before (or off) */
    fun restoreDnd(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val before = prefs.getInt("dndBefore", NotificationManager.INTERRUPTION_FILTER_ALL)
        if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(if (before == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) NotificationManager.INTERRUPTION_FILTER_ALL else before)
        ctx.getSystemService(AlarmManager::class.java).cancel(restoreIntent(ctx))
        prefs.edit().remove("dndBefore").remove("dndUntil").apply()
        Log.i(TAG, "Do Not Disturb restored")
    }

    private fun flashlight(ctx: Context, on: Boolean): JSONObject {
        val cm = ctx.getSystemService(CameraManager::class.java)
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            ?: return outcome("failed", "🔦", "This phone has no flashlight")
        cm.setTorchMode(id, on)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("torch", on).apply()
        Log.i(TAG, "Torch ${if (on) "on" else "off"}")
        return outcome("done", "🔦", "Flashlight ${if (on) "on" else "off"}", undo = on)
    }

    private fun openApp(ctx: Context, a: JSONObject, choice: JSONObject?): JSONObject {
        val name = a.optString("appName")
        val pkg = choice?.optString("package")?.takeIf { it.isNotBlank() } ?: run {
            val matches = apps(ctx, name)
            when {
                matches.isEmpty() -> return outcome("failed", "📱", "No app called “$name” on this phone")
                matches.size > 1 && matches[0].optInt("score") == matches[1].optInt("score") -> {
                    askInApp(ctx, a, "📱", "Which $name?", "${matches.size} apps match — tap to choose")
                    return outcome("needs_choice", "📱", "Which $name? ${matches.size} apps match", "Tap to choose")
                }
                else -> matches[0].optString("package")
            }
        }
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return outcome("failed", "📱", "Couldn't open $name")
        val label = runCatching { ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(name)
        return launch(ctx, intent, a, "📱", "Opened $label", "Tap to open $label")
    }

    // ── Undo ───────────────────────────────────────────────────────────────

    /** Alarm/timer: Clock's list (delete it there). Flashlight: off. DND: back to before. */
    fun undo(ctx: Context, a: JSONObject): JSONObject {
        val out = when (a.optString("kind")) {
            "alarm" -> launch(ctx, toClock(ctx, Intent(AlarmClock.ACTION_SHOW_ALARMS)), a, "↩️", "Clock opened — delete the alarm there", "Tap to open Clock's alarms", report = false)
                .put("detail", "Alarms you set by voice are deleted in the Clock app")
            "timer" -> launch(ctx, toClock(ctx, Intent(if (Build.VERSION.SDK_INT >= 26) AlarmClock.ACTION_SHOW_TIMERS else AlarmClock.ACTION_SHOW_ALARMS)), a, "↩️", "Clock opened — stop the timer there", "Tap to open Clock's timers", report = false)
            "flashlight" -> flashlight(ctx, false)
            "dnd" -> { restoreDnd(ctx); outcome("done", "↩️", "Do Not Disturb back to how it was") }
            else -> outcome("failed", "↩️", "This one can't be undone")
        }
        if (out.optString("status") != "failed") report(ctx, a.optString("id"), "undone", out.optString("text"), null)
        return out
    }

    // ── Starting other apps ────────────────────────────────────────────────

    /** May we open another app right now? (on screen, or "Display over other apps") */
    fun canStartNow(ctx: Context) = QuickRecorderPlugin.isAppVisible() || Settings.canDrawOverlays(ctx)

    private fun launch(
        ctx: Context, intent: Intent, a: JSONObject, icon: String, doneText: String, tapText: String,
        undoDetail: String? = null, undo: Boolean = false, report: Boolean = true,
    ): JSONObject {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (canStartNow(ctx)) {
            return try {
                ctx.startActivity(intent)
                outcome("done", icon, doneText, undoDetail, undo)
            } catch (e: ActivityNotFoundException) {
                outcome("failed", icon, "No app on this phone can do that", e.message)
            }
        }
        // From the background: a notification to tap (it opens by itself on the lock screen when allowed)
        val pi = PendingIntent.getActivity(ctx, a.optString("id").hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        post(ctx, "$icon $tapText", "Allow “Display over other apps” in Settings → Alarms & phone actions to skip this tap", pi, fullScreen = true)
        return outcome("tap", icon, tapText, "Tap the notification", undo = false).also { if (!report) it.put("report", false) }
    }

    /** Needs a choice or a permission: open Quick Capture → Actions on that entry */
    private fun askInApp(ctx: Context, a: JSONObject, icon: String, title: String, text: String) {
        post(ctx, "$icon $title", text, Notifications.openApp(ctx, "/quick/actions?choose=${a.optString("id")}"))
    }

    private fun post(ctx: Context, title: String, text: String, tap: PendingIntent, fullScreen: Boolean = false) {
        Notifications.ensureChannels(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val fsi = fullScreen && (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent())
        val n = NotificationCompat.Builder(ctx, Notifications.CH_ACTIONS)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .apply { if (fsi) setFullScreenIntent(tap, true) }
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_ACTION, n) } catch (_: SecurityException) { /* notifications off */ }
    }

    // ── Lookups ────────────────────────────────────────────────────────────

    private fun norm(s: String) = s.lowercase().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    /** Contacts whose name matches: exact first-name / full-name matches win over partial ones */
    fun contacts(ctx: Context, name: String): List<JSONObject> {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return emptyList()
        val want = norm(name)
        if (want.isEmpty()) return emptyList()
        val byContact = LinkedHashMap<Long, JSONObject>()
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.CONTACT_ID, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.TYPE),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?", arrayOf("%${name.trim()}%"), null,
        )?.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0); val display = c.getString(1) ?: continue; val number = c.getString(2) ?: continue
                val mobile = c.getInt(3) == ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE
                val prev = byContact[id]
                if (prev == null || (mobile && !prev.optBoolean("mobile"))) {
                    val n = norm(display)
                    val score = when { n == want -> 3; n.split(" ").firstOrNull() == want -> 2; n.split(" ").contains(want) -> 1; else -> 0 }
                    byContact[id] = JSONObject().put("id", "c$id").put("label", display).put("number", number).put("sub", number).put("mobile", mobile).put("score", score)
                }
            }
        }
        val all = byContact.values.sortedByDescending { it.optInt("score") }
        val best = all.firstOrNull()?.optInt("score") ?: 0
        return if (best > 0) all.filter { it.optInt("score") == best } else all
    }

    /** Launchable apps whose name matches: exact > starts with > contains */
    fun apps(ctx: Context, name: String): List<JSONObject> {
        val want = norm(name)
        val pm = ctx.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(launcher, 0).mapNotNull { ri ->
            val label = ri.loadLabel(pm).toString()
            val n = norm(label)
            val score = when { n == want -> 3; n.startsWith(want) || want.startsWith(n) -> 2; n.contains(want) -> 1; else -> 0 }
            if (score == 0 || ri.activityInfo.packageName == ctx.packageName) null
            else JSONObject().put("id", ri.activityInfo.packageName).put("label", label).put("package", ri.activityInfo.packageName).put("sub", ri.activityInfo.packageName).put("score", score)
        }.distinctBy { it.optString("package") }.sortedByDescending { it.optInt("score") }.let { list ->
            val best = list.firstOrNull()?.optInt("score") ?: 0
            list.filter { it.optInt("score") == best }
        }
    }

    private fun installed(ctx: Context, pkg: String) = runCatching { ctx.packageManager.getPackageInfo(pkg, 0); true }.getOrDefault(false)

    /**
     * Alarms/timers go to Samsung Clock when it's there (it syncs alarms to the Galaxy Watch), else Google Clock.
     * Phones with both would otherwise show "Open with…" and nothing would be set.
     */
    private val CLOCKS = listOf("com.sec.android.app.clockpackage", "com.google.android.deskclock")
    private fun toClock(ctx: Context, intent: Intent): Intent {
        for (pkg in CLOCKS) {
            val i = Intent(intent).setPackage(pkg)
            if (i.resolveActivity(ctx.packageManager) != null) return i
        }
        return intent
    }

    /** Settings → Alarms & phone actions: what's ready on this phone */
    fun status(ctx: Context): JSONObject = JSONObject()
        .put("clock", Intent(AlarmClock.ACTION_SET_ALARM).resolveActivity(ctx.packageManager) != null || installed(ctx, "com.sec.android.app.clockpackage") || installed(ctx, "com.google.android.deskclock"))
        .put("background", Settings.canDrawOverlays(ctx))
        .put("contacts", if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) "granted" else "prompt")
        .put("dnd", ctx.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted)

    // ── Report to the server ───────────────────────────────────────────────

    fun report(ctx: Context, id: String?, status: String, result: String, detail: String?) {
        if (id.isNullOrBlank()) return
        val request = OneTimeWorkRequestBuilder<ActionReportWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("id" to id, "status" to status, "result" to result, "detail" to detail))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("action-report-$id", ExistingWorkPolicy.REPLACE, request)
    }

    fun contactsOf(ctx: Context, name: String) = JSONArray().apply { contacts(ctx, name).forEach { put(it) } }
    fun appsOf(ctx: Context, name: String) = JSONArray().apply { apps(ctx, name).forEach { put(it) } }
}

/** POST /api/actions/:id/result (retries until online) */
class ActionReportWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val api = TokenStore.apiBase(applicationContext) ?: return Result.success()
        val token = TokenStore.token(applicationContext) ?: return Result.success()
        val id = inputData.getString("id") ?: return Result.success()
        val body = JSONObject().put("status", inputData.getString("status")).put("result", inputData.getString("result"))
            .apply { inputData.getString("detail")?.let { put("detail", it) } }.toString()
        return try {
            OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).build().newCall(
                Request.Builder().url("$api/api/actions/$id/result").header("Authorization", "Bearer $token")
                    .post(body.toRequestBody("application/json".toMediaType())).build(),
            ).execute().use { r -> if (r.isSuccessful || r.code == 404) Result.success() else if (r.code >= 500 || r.code == 429) Result.retry() else Result.success() }
        } catch (_: java.io.IOException) { Result.retry() }
    }
}

/** Do Not Disturb "for an hour": turned back off */
class DndRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = PhoneActions.restoreDnd(ctx)
}

/** "Undo" on an action's notification */
class ActionUndoReceiver : BroadcastReceiver() {
    companion object { const val EXTRA_ACTION = "action" }
    override fun onReceive(ctx: Context, intent: Intent) {
        val a = intent.getStringExtra(EXTRA_ACTION)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        NotificationManagerCompat.from(ctx).cancel(Notifications.ID_RESULT)
        PhoneActions.undo(ctx, a)
    }
}
