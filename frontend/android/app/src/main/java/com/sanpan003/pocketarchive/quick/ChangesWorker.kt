package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.sanpan003.pocketarchive.R
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * Shared lists in the background (no push service): every 15 minutes, with a network, asks the server
 * for other people's changes since the last check (GET /api/changes), refreshes the widget and the
 * geofences / watch state when there were any, and posts a local notification following the user's
 * settings (Every change / Summary / Off + quiet hours). Not local-only, so the watch shows it too.
 * While the app is on screen it stays quiet: the app shows changes live.
 */
class ChangesWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    data class Change(val noteId: String, val title: String, val byName: String, val action: String, val text: String?)

    override fun doWork(): Result {
        val ctx = applicationContext
        val apiBase = TokenStore.apiBase(ctx) ?: return Result.success()
        val token = TokenStore.token(ctx) ?: return Result.success()
        val userId = TokenStore.userId(ctx) ?: return Result.success()
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val sinceKey = "since_$userId"
        val first = prefs.getString(sinceKey, null) == null
        // First check for this user: start from now (no flood of old changes)
        val since = prefs.getString(sinceKey, null) ?: java.time.Instant.now().toString()

        val body = try {
            val request = Request.Builder()
                .url("$apiBase/api/changes?since=${URLEncoder.encode(since, "UTF-8")}")
                .header("Authorization", "Bearer $token")
                .build()
            client.newCall(request).execute().use { r ->
                if (!r.isSuccessful) return Result.success() // signed out / server down: next round
                JSONObject(r.body.string())
            }
        } catch (e: Exception) {
            Log.i(TAG, "Check skipped: ${e.javaClass.simpleName}")
            return Result.success()
        }

        prefs.edit().putString(sinceKey, body.optString("now", since)).apply()
        if (first) return Result.success()

        val list = body.optJSONArray("changes")
        val changes = (0 until (list?.length() ?: 0)).mapNotNull { i ->
            val c = list!!.optJSONObject(i) ?: return@mapNotNull null
            Change(c.optString("noteId"), c.optString("title"), c.optString("byName", "Someone"), c.optString("action"), c.optString("text").takeIf { it.isNotBlank() && it != "null" })
        }
        if (changes.isEmpty() && prefs.getInt(quietKey(userId), 0) == 0) return Result.success()

        if (changes.isNotEmpty()) {
            // Fresh lists on the home screen, the watch and the geofences (shared errands)
            if (QuickToggleWidget.hasWidgets(ctx)) WidgetData.refreshBlocking(ctx)
            ErrandWorker.syncNow(ctx)
        }

        val notify = body.optJSONObject("notify") ?: JSONObject()
        val mode = notify.optString("mode", "every")
        if (mode == "off") { prefs.edit().remove(quietKey(userId)).apply(); return Result.success() }
        if (QuickRecorderPlugin.isAppVisible()) { prefs.edit().remove(quietKey(userId)).apply(); return Result.success() }

        // Quiet hours: count now, one summary afterwards
        if (inQuietHours(notify.optString("quietStart", ""), notify.optString("quietEnd", ""))) {
            prefs.edit().putInt(quietKey(userId), prefs.getInt(quietKey(userId), 0) + changes.size).apply()
            return Result.success()
        }
        val held = prefs.getInt(quietKey(userId), 0)
        prefs.edit().remove(quietKey(userId)).apply()

        if (mode == "every" && held == 0 && changes.size <= MAX_SINGLE) changes.forEach { post(ctx, it) }
        else postSummary(ctx, changes, changes.size + held)
        return Result.success()
    }

    private fun line(c: Change): String = when (c.action) {
        "added" -> "${c.byName} added ${c.text ?: "an item"}"
        "removed" -> "${c.byName} removed ${c.text ?: "an item"}"
        "checked" -> "${c.byName} checked off ${c.text ?: "an item"}"
        "unchecked" -> "${c.byName} unchecked ${c.text ?: "an item"}"
        "edited" -> "${c.byName} edited ${c.text ?: "an item"}"
        "renamed" -> "${c.byName} renamed it to ${c.text ?: ""}"
        "edited the text" -> "${c.byName} edited the text"
        "at-store" -> "${c.byName} is at ${c.text ?: "the store"}"
        "done" -> "${c.byName} marked it done"
        "reopened" -> "${c.byName} reopened it"
        "shared with" -> "${c.byName} shared it with you"
        else -> "${c.byName} changed it"
    }

    private fun post(ctx: Context, c: Change) {
        Notifications.ensureChannels(ctx)
        if (!Notifications.canPost(ctx)) return
        val n = NotificationCompat.Builder(ctx, Notifications.CH_SHARED)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle(if (c.action == "at-store") "📍 ${line(c)}" else line(c))
            .setContentText(c.title)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setGroup(GROUP)
            .setAutoCancel(true)
            .setContentIntent(Notifications.openApp(ctx, "/quick/${c.noteId}"))
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(ID_BASE + (c.noteId + c.action + c.text).hashCode() % 100000, n)
        } catch (_: SecurityException) { /* notifications off */ }
    }

    private fun postSummary(ctx: Context, changes: List<Change>, total: Int) {
        Notifications.ensureChannels(ctx)
        if (!Notifications.canPost(ctx) || total == 0) return
        val style = NotificationCompat.InboxStyle()
        changes.takeLast(5).forEach { style.addLine("${line(it)} · ${it.title}") }
        if (total > 5) style.setSummaryText("+${total - minOf(5, changes.size)} more")
        val title = if (total == 1) "1 change on shared lists" else "$total changes on shared lists"
        val notes = changes.map { it.noteId }.distinct()
        val n = NotificationCompat.Builder(ctx, Notifications.CH_SHARED)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle(title)
            .setContentText(changes.lastOrNull()?.let { "${line(it)} · ${it.title}" } ?: "While notifications were quiet")
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setContentIntent(Notifications.openApp(ctx, if (notes.size == 1) "/quick/${notes[0]}" else "/quick/inbox"))
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(ID_SUMMARY, n)
        } catch (_: SecurityException) { /* notifications off */ }
    }

    companion object {
        private const val TAG = "SharedChanges"
        private const val PREFS = "shared_changes"
        private const val PERIODIC = "shared-changes"
        private const val GROUP = "shared_changes"
        private const val ID_BASE = 4000000
        private const val ID_SUMMARY = 1010
        private const val MAX_SINGLE = 4
        private fun quietKey(userId: String) = "quiet_$userId"

        private val client by lazy {
            OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
        }

        /** "22:00"–"07:00" (over midnight) or "13:00"–"14:00"; empty = no quiet hours */
        fun inQuietHours(start: String, end: String, now: LocalTime = LocalTime.now()): Boolean {
            val s = runCatching { LocalTime.parse(start) }.getOrNull() ?: return false
            val e = runCatching { LocalTime.parse(end) }.getOrNull() ?: return false
            if (s == e) return false
            return if (s < e) now >= s && now < e else now >= s || now < e
        }

        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<ChangesWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Check once, now or after [delayMs] (Settings / tests: a delay lets you leave the app first) */
        fun runNow(ctx: Context, delayMs: Long = 0) {
            val request = OneTimeWorkRequestBuilder<ChangesWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("$PERIODIC-now", ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
        }
    }
}
