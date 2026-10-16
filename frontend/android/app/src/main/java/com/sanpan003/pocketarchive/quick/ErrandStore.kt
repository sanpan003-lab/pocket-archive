package com.sanpan003.pocketarchive.quick

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Active arrival errands from GET /api/errands/active (store coordinates only),
 * plus local state the server never sees: when a reminder fired at which store,
 * snoozes, and errands marked done from a notification but not yet confirmed.
 */
object ErrandStore {
    data class Branch(
        val key: String,
        val lat: Double,
        val lng: Double,
        val name: String?,
        val address: String?,
        val distanceM: Int?,
    )

    data class Item(val text: String, val done: Boolean)

    data class Errand(
        val id: String,
        val title: String,
        val placeName: String?,
        val items: List<Item>,
        val branches: List<Branch>,
        /** "errand" (store list) or "reminder" (any note tied to a personal place) */
        val kind: String = "errand",
        /** "arrive" (DWELL) or "leave" (EXIT) */
        val whenAt: String = "arrive",
        val text: String? = null,
        val radiusM: Float = 150f,
    ) {
        val openItems get() = items.filter { !it.done }
        val isReminder get() = kind == "reminder"
        val leaving get() = whenAt == "leave"
    }

    private const val PREFS = "errands"
    private const val KEY_ERRANDS = "errands"
    private const val KEY_FIRED = "fired"        // "errandId|branchKey" → millis
    private const val KEY_SNOOZED = "snoozed"    // errandId → until millis
    private const val KEY_DONE = "doneLocal"     // errandId → millis

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun save(ctx: Context, errands: JSONArray) {
        parse(errands) // validate before caching
        prefs(ctx).edit().putString(KEY_ERRANDS, errands.toString()).apply()
        // Forget local state for errands the server no longer lists
        val ids = (0 until errands.length()).mapNotNull { errands.optJSONObject(it)?.optString("id") }.toSet()
        prune(ctx, KEY_DONE) { it in ids }
        prune(ctx, KEY_SNOOZED) { it in ids }
        prune(ctx, KEY_FIRED) { it.substringBefore('|') in ids }
    }

    fun errands(ctx: Context): List<Errand> =
        runCatching { parse(JSONArray(prefs(ctx).getString(KEY_ERRANDS, "[]"))) }.getOrDefault(emptyList())

    fun errand(ctx: Context, id: String) = errands(ctx).firstOrNull { it.id == id }

    /** Errands that should have geofences (not finished from a notification meanwhile). */
    fun armed(ctx: Context) = errands(ctx).filter { !isLocallyDone(ctx, it.id) }

    @Synchronized
    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    // ── Diagnostics (Settings → Location reminders) ─────────────────────────
    fun recordEvent(ctx: Context, transition: String, key: String) {
        prefs(ctx).edit().putString("lastEvent", JSONObject().put("at", System.currentTimeMillis()).put("transition", transition).put("key", key).toString()).apply()
    }

    fun lastEvent(ctx: Context): JSONObject? = prefs(ctx).getString("lastEvent", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun setArmedCount(ctx: Context, n: Int, error: String?) {
        prefs(ctx).edit().putInt("armed", n).putString("armError", error).putLong("armedAt", System.currentTimeMillis()).apply()
    }

    fun armedInfo(ctx: Context): JSONObject = JSONObject()
        .put("count", prefs(ctx).getInt("armed", 0))
        .put("error", prefs(ctx).getString("armError", null))
        .put("at", prefs(ctx).getLong("armedAt", 0L))

    // ── Local state ─────────────────────────────────────────────────────────

    fun lastFired(ctx: Context, errandId: String, key: String) = map(ctx, KEY_FIRED).optLong("$errandId|$key", 0L)

    fun setFired(ctx: Context, errandId: String, key: String, at: Long) = put(ctx, KEY_FIRED, "$errandId|$key", at)

    fun snoozedUntil(ctx: Context, errandId: String) = map(ctx, KEY_SNOOZED).optLong(errandId, 0L)

    fun snooze(ctx: Context, errandId: String, until: Long) = put(ctx, KEY_SNOOZED, errandId, until)

    fun isLocallyDone(ctx: Context, errandId: String) = map(ctx, KEY_DONE).has(errandId)

    fun markLocallyDone(ctx: Context, errandId: String) = put(ctx, KEY_DONE, errandId, System.currentTimeMillis())

    private fun map(ctx: Context, key: String) =
        runCatching { JSONObject(prefs(ctx).getString(key, "{}")!!) }.getOrDefault(JSONObject())

    @Synchronized
    private fun put(ctx: Context, key: String, name: String, value: Long) {
        val m = map(ctx, key).put(name, value)
        prefs(ctx).edit().putString(key, m.toString()).apply()
    }

    @Synchronized
    private fun prune(ctx: Context, key: String, keep: (String) -> Boolean) {
        val m = map(ctx, key)
        val drop = m.keys().asSequence().filter { !keep(it) }.toList()
        if (drop.isEmpty()) return
        drop.forEach { m.remove(it) }
        prefs(ctx).edit().putString(key, m.toString()).apply()
    }

    private fun parse(array: JSONArray): List<Errand> = (0 until array.length()).mapNotNull { i ->
        val o = array.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        val items = o.optJSONArray("items") ?: JSONArray()
        val branches = o.optJSONArray("branches") ?: JSONArray()
        Errand(
            id = id,
            title = o.optString("title", "Errand"),
            placeName = o.optString("placeName").takeIf { it.isNotBlank() && it != "null" },
            items = (0 until items.length()).mapNotNull { j ->
                items.optJSONObject(j)?.let { Item(it.optString("text"), it.optBoolean("done")) }
            },
            branches = (0 until branches.length()).mapNotNull { j ->
                val b = branches.optJSONObject(j) ?: return@mapNotNull null
                val lat = b.optDouble("lat", Double.NaN)
                val lng = b.optDouble("lng", Double.NaN)
                if (lat.isNaN() || lng.isNaN()) return@mapNotNull null
                Branch(
                    key = b.optString("key").ifBlank { String.format(Locale.US, "%.5f,%.5f", lat, lng) },
                    lat = lat, lng = lng,
                    name = b.optString("name").takeIf { it.isNotBlank() && it != "null" },
                    address = b.optString("address").takeIf { it.isNotBlank() && it != "null" },
                    distanceM = if (b.isNull("distanceM")) null else b.optInt("distanceM"),
                )
            },
            kind = o.optString("kind", "errand"),
            whenAt = o.optString("when", "arrive").takeIf { it == "leave" } ?: "arrive",
            text = o.optString("text").takeIf { it.isNotBlank() && it != "null" },
            radiusM = o.optDouble("radiusM", 150.0).toFloat().coerceIn(80f, 500f),
        )
    }
}
