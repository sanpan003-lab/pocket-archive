package com.sanpan003.pocketarchive.quick

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The widget's list of recent quick notes (GET /api/quick/recent), cached on
 * the phone so the widget draws instantly and still shows something offline.
 */
object WidgetData {
    data class Item(
        val id: String,
        val title: String,
        val type: String,
        val createdAt: Long,
        val needsReview: Boolean,
        val itemsDone: Int = 0,
        val itemsTotal: Int = 0,
        val icon: String? = null,               // phone actions: ⏰ ⏲ 📍 …
    ) {
        /** "2/4" for errands with a checklist. */
        val progress get() = if (type == "errand" && itemsTotal > 0) "$itemsDone/$itemsTotal" else null
    }

    private const val PREFS = "widget_cache"
    // The widget shows up to 50 (2.10.0) — with the fields its filters, Up next and checklists need (full=1)
    private const val LIMIT = 50

    private val io = Executors.newSingleThreadExecutor()
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun items(ctx: Context): List<Item> =
        runCatching { parse(JSONArray(prefs(ctx).getString("items", "[]"))) }.getOrDefault(emptyList())

    /** The saved list as the server sent it (the widget model reads these when there's no offline copy) */
    fun raw(ctx: Context): List<JSONObject> = runCatching {
        val a = JSONArray(prefs(ctx).getString("items", "[]"))
        (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }.getOrDefault(emptyList())

    fun fetchedAt(ctx: Context): Long = prefs(ctx).getLong("fetchedAt", 0L)

    /** Last refresh couldn't reach the server (list may be out of date). */
    fun offline(ctx: Context) = prefs(ctx).getBoolean("offline", false)

    /** The server rejected the device token. */
    fun signedOut(ctx: Context) = prefs(ctx).getBoolean("signedOut", false) || TokenStore.token(ctx) == null

    fun refreshAsync(ctx: Context) {
        val app = ctx.applicationContext
        io.execute { refreshBlocking(app) }
    }

    /** Fetch the list now; returns false when the server couldn't be reached. */
    fun refreshBlocking(ctx: Context): Boolean {
        val apiBase = TokenStore.apiBase(ctx)
        val token = TokenStore.token(ctx)
        if (apiBase == null || token == null) {
            QuickToggleWidget.updateAll(ctx)
            return true
        }
        // App locked: the capture-only token can't read notes (and the widget doesn't show them then)
        if (AppLock.isLocked(ctx)) return true
        val request = Request.Builder()
            .url("$apiBase/api/quick/recent?limit=$LIMIT&full=1")
            .header("Authorization", "Bearer $token")
            .build()
        val ok = try {
            client.newCall(request).execute().use { response ->
                val text = response.body.string()
                when {
                    response.isSuccessful -> {
                        val list = JSONArray(text)
                        parse(list) // validate before caching
                        prefs(ctx).edit()
                            .putString("items", list.toString())
                            .putBoolean("offline", false)
                            .putBoolean("signedOut", false)
                            .putLong("fetchedAt", System.currentTimeMillis())
                            .apply()
                        true
                    }
                    response.code == 401 -> {
                        prefs(ctx).edit().putBoolean("signedOut", true).putBoolean("offline", false).apply()
                        true
                    }
                    else -> {
                        prefs(ctx).edit().putBoolean("offline", true).apply()
                        false
                    }
                }
            }
        } catch (e: IOException) {
            // No connection: the offline copy's newest notes (2.9.0), still marked offline
            val local = runCatching {
                com.sanpan003.pocketarchive.offline.OfflineStore.open(ctx)?.let { d -> com.sanpan003.pocketarchive.offline.OfflineViews.recent(d.notes("own"), LIMIT, false) }
            }.getOrNull()
            prefs(ctx).edit().putBoolean("offline", true).apply { if (local != null && local.length() > 0) putString("items", local.toString()) }.apply()
            false
        } catch (e: JSONException) {
            false
        }
        QuickToggleWidget.updateAll(ctx)
        return ok
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        QuickToggleWidget.updateAll(ctx)
    }

    private fun parse(array: JSONArray): List<Item> = (0 until array.length()).mapNotNull { i ->
        val o: JSONObject = array.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        Item(
            id = id,
            title = o.optString("title").takeIf { it.isNotBlank() && it != "null" } ?: "Quick note",
            type = o.optString("type", "note"),
            createdAt = parseTime(o.optString("createdAt")),
            needsReview = o.optBoolean("needsReview", false),
            itemsDone = o.optInt("itemsDone", 0),
            itemsTotal = o.optInt("itemsTotal", 0),
            icon = o.optString("icon").takeIf { it.isNotBlank() && it != "null" },
        )
    }

    private fun parseTime(text: String): Long =
        runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(text).toEpochMilli() }
            .getOrDefault(0L)

    fun typeIcon(type: String, icon: String? = null) = icon ?: when (type) {
        "event" -> "📅"
        "reminder" -> "⏰"
        "errand" -> "🛒"
        "note_link" -> "🔗"
        else -> "📝"
    }

    /** "now", "5m ago", "2h ago", "3d ago", "Oct 2". */
    fun relativeTime(millis: Long, now: Long = System.currentTimeMillis()): String {
        if (millis <= 0) return ""
        val minutes = (now - millis) / 60_000
        return when {
            minutes < 1 -> "now"
            minutes < 60 -> "${minutes}m ago"
            minutes < 24 * 60 -> "${minutes / 60}h ago"
            minutes < 7 * 24 * 60 -> "${minutes / (24 * 60)}d ago"
            else -> DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
                .format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()))
        }
    }
}
