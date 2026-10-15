package com.sanpan003.pocketarchive.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime

data class RecentNote(
    val id: String,
    val title: String,
    val type: String,
    val createdAt: Long,
    val needsReview: Boolean,
    val summary: String?,
    val itemsDone: Int,
    val itemsTotal: Int,
)

data class ErrandItem(val id: String, val text: String, val done: Boolean)

data class Errand(
    val id: String,
    val title: String,
    val placeName: String?,
    val address: String?,
    val whenLabel: String?,
    val arrival: Boolean,
    val items: List<ErrandItem>,
) {
    val openCount get() = items.count { !it.done }
}

data class WatchSnapshot(val recent: List<RecentNote>, val errands: List<Errand>, val updatedAt: Long)

/**
 * Recent notes + open errands synced from the phone (DataClient "/pa/state"),
 * cached so the watch works offline. Checklist taps apply instantly here and
 * stay "pending" until the phone confirms them (works offline: the Data
 * Layer delivers the change when the phone is back).
 */
object WatchData {
    private const val PREFS = "watch_data"

    private val _snapshot = MutableStateFlow(WatchSnapshot(emptyList(), emptyList(), 0))
    val snapshot: StateFlow<WatchSnapshot> = _snapshot.asStateFlow()
    @Volatile private var loaded = false

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(ctx: Context) {
        if (loaded) return
        loaded = true
        rebuild(ctx)
    }

    /** New state from the phone. Pending checklist changes it already reflects are dropped. */
    fun apply(ctx: Context, recentJson: String?, errandsJson: String?, updatedAt: Long) {
        prefs(ctx).edit()
            .putString("recent", recentJson ?: "[]")
            .putString("errands", errandsJson ?: "[]")
            .putLong("updatedAt", updatedAt)
            .apply()
        val errands = parseErrands(errandsJson ?: "[]")
        val pending = pending(ctx)
        val keep = JSONObject()
        pending.keys().forEach { k ->
            val (eId, iId) = k.split('|', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            val want = pending.getJSONObject(k).optBoolean("done")
            val actual = errands.firstOrNull { it.id == eId }?.items?.firstOrNull { it.id == iId }?.done
            val age = System.currentTimeMillis() - pending.getJSONObject(k).optLong("at")
            if (actual != null && actual != want && age < 24 * 3600_000L) keep.put(k, pending.getJSONObject(k))
        }
        prefs(ctx).edit().putString("pending", keep.toString()).apply()
        rebuild(ctx)
        RecordTileService.requestUpdate(ctx)
    }

    /** Tap on a checklist item: update instantly, send to the phone (queued by the Data Layer if offline). */
    fun toggle(ctx: Context, errandId: String, itemId: String, done: Boolean) {
        val pending = pending(ctx).put("$errandId|$itemId", JSONObject().put("done", done).put("at", System.currentTimeMillis()))
        prefs(ctx).edit().putString("pending", pending.toString()).apply()
        rebuild(ctx)
        PhoneLink.putToggle(ctx, errandId, itemId, done)
    }

    /** The phone applied the change (it deleted the DataItem). */
    fun confirmed(ctx: Context, errandId: String, itemId: String) {
        // Keep showing the local value until the refreshed state arrives; just drop very old entries
        val pending = pending(ctx)
        val entry = pending.optJSONObject("$errandId|$itemId") ?: return
        if (System.currentTimeMillis() - entry.optLong("at") > 24 * 3600_000L) {
            pending.remove("$errandId|$itemId")
            prefs(ctx).edit().putString("pending", pending.toString()).apply()
            rebuild(ctx)
        }
    }

    fun errand(id: String) = _snapshot.value.errands.firstOrNull { it.id == id }
    fun note(id: String) = _snapshot.value.recent.firstOrNull { it.id == id }

    private fun pending(ctx: Context) =
        runCatching { JSONObject(prefs(ctx).getString("pending", "{}")!!) }.getOrDefault(JSONObject())

    private fun rebuild(ctx: Context) {
        val p = prefs(ctx)
        val pending = pending(ctx)
        val errands = parseErrands(p.getString("errands", "[]")!!).map { e ->
            e.copy(items = e.items.map { i ->
                pending.optJSONObject("${e.id}|${i.id}")?.let { i.copy(done = it.optBoolean("done")) } ?: i
            })
        }
        _snapshot.value = WatchSnapshot(parseRecent(p.getString("recent", "[]")!!), errands, p.getLong("updatedAt", 0))
    }

    private fun parseTime(s: String?): Long =
        runCatching { OffsetDateTime.parse(s).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(s).toEpochMilli() }
            .getOrDefault(0L)

    private fun JSONObject.str(key: String) = optString(key).takeIf { it.isNotBlank() && it != "null" }

    private fun parseRecent(json: String): List<RecentNote> = runCatching {
        val a = JSONArray(json)
        (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            RecentNote(
                id = o.str("id") ?: return@mapNotNull null,
                title = o.str("title") ?: "Quick note",
                type = o.optString("type", "note"),
                createdAt = parseTime(o.optString("createdAt")),
                needsReview = o.optBoolean("needsReview"),
                summary = o.str("summary"),
                itemsDone = o.optInt("itemsDone"),
                itemsTotal = o.optInt("itemsTotal"),
            )
        }
    }.getOrDefault(emptyList())

    private fun parseErrands(json: String): List<Errand> = runCatching {
        val a = JSONArray(json)
        (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            val items = o.optJSONArray("items") ?: JSONArray()
            Errand(
                id = o.str("id") ?: return@mapNotNull null,
                title = o.str("title") ?: "Errand",
                placeName = o.str("placeName"),
                address = o.str("address"),
                whenLabel = o.str("whenLabel"),
                arrival = o.optBoolean("arrival"),
                items = (0 until items.length()).mapNotNull { j ->
                    val it = items.optJSONObject(j) ?: return@mapNotNull null
                    ErrandItem(it.str("id") ?: return@mapNotNull null, it.optString("text"), it.optBoolean("done"))
                },
            )
        }
    }.getOrDefault(emptyList())

    fun typeIcon(type: String) = when (type) {
        "event" -> "📅"
        "reminder" -> "⏰"
        "errand" -> "🛒"
        "note_link" -> "🔗"
        else -> "📝"
    }

    /** "now", "5m", "2h", "3d" */
    fun ago(millis: Long, now: Long = System.currentTimeMillis()): String {
        if (millis <= 0) return ""
        val m = (now - millis) / 60_000
        return when {
            m < 1 -> "now"
            m < 60 -> "${m}m"
            m < 1440 -> "${m / 60}h"
            else -> "${m / 1440}d"
        }
    }
}
