package com.sanpan003.pocketarchive.quick

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Settings → Accidental recordings → "Recent recording starts": every start request — from the side key,
 * Quick Record, a routine, the volume keys, the widget, the tile, the app or the watch — with the screen
 * state at the press, the proximity reading, what the voice detector heard and what happened (recorded →
 * which note, or ignored and why). Kept on this phone only (last 50; the app shows 20).
 * Nothing personal: no audio, no transcript; the note title only for recordings that became notes.
 */
object RecordingLog {
    private const val PREFS = "recording_log"
    private const val MAX = 50
    private val lock = Any()

    // Where a start came from (stable ids, sent to the server as a readable label)
    const val APP = "app"
    const val QUICK_RECORD = "quick-record"   // the "Quick Record" launcher entry (side key, routine, home icon)
    const val APP_SHORTCUT = "app-shortcut"   // long-press the app icon → Quick record
    const val VOLUME_KEYS = "volume-key"      // accessibility double-press
    const val WIDGET = "widget"
    const val TILE = "tile"
    const val WATCH = "watch"

    /** Hardware / system triggers: the ones "Only when unlocked" applies to */
    val KEY_TRIGGERS = setOf(QUICK_RECORD, APP_SHORTCUT, VOLUME_KEYS)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Readable trigger: the referrer tells a routine / home-screen icon / side key apart */
    fun label(source: String, referrer: String?): String {
        val r = referrer.orEmpty()
        return when (source) {
            APP -> "In the app"
            QUICK_RECORD -> when {
                r.contains("routine", true) -> "Samsung Routine"
                r.contains("bixby", true) -> "Bixby"
                r.contains("launcher", true) || r.contains("honeyspace", true) -> "Home screen icon"
                r == "com.android.shell" -> "adb (test)"
                r.isBlank() || r == "android" || r.contains("systemui", true) || r.contains("keycustom", true) -> "Side key / Quick Record"
                else -> "Quick Record ($r)"
            }
            APP_SHORTCUT -> "App shortcut"
            VOLUME_KEYS -> "Volume keys (double press)"
            WIDGET -> "Widget"
            TILE -> "Quick Settings tile"
            "notification" -> "Notification"
            else -> if (source.startsWith(WATCH)) "Watch" + source.removePrefix(WATCH).replace(':', ' ').let { if (it.isBlank()) "" else " —$it" } else "Other"
        }
    }

    /** Screen at the press: off | locked | on, and whether the press just woke it */
    data class Screen(val state: String, val justWoken: Boolean)

    fun screenNow(ctx: Context): Screen {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val km = ctx.getSystemService(KeyguardManager::class.java)
        val state = when {
            pm?.isInteractive == false -> "off"
            km?.isKeyguardLocked == true -> "locked"
            else -> "on"
        }
        val now = SystemClock.elapsedRealtime()
        val woken = PocketCheck.screenOnAgoMs()?.let { it < 4_000 } ?: (now - Process.getStartElapsedRealtime() < 5_000)
        return Screen(state, woken)
    }

    /** A new start request → its id (the entry is updated as things happen) */
    fun start(ctx: Context, source: String, referrer: String?, screen: Screen = screenNow(ctx)): String {
        val id = UUID.randomUUID().toString().take(8)
        val e = JSONObject()
            .put("id", id).put("at", System.currentTimeMillis()).put("device", "phone")
            .put("source", source).put("trigger", label(source, referrer))
            .put("screen", screen.state).put("justWoken", screen.justWoken)
            .put("result", "starting")
        if (!referrer.isNullOrBlank()) e.put("referrer", referrer)
        add(ctx, e)
        return id
    }

    /** One that never reached the recorder (guards) */
    fun ignoredStart(ctx: Context, source: String, referrer: String?, reason: String) {
        val id = start(ctx, source, referrer)
        update(ctx, id, "result" to "ignored", "reason" to reason)
    }

    fun update(ctx: Context, id: String?, vararg fields: Pair<String, Any?>) {
        if (id == null) return
        edit(ctx) { list ->
            for (i in 0 until list.length()) {
                val e = list.getJSONObject(i)
                if (e.optString("id") == id) { fields.forEach { (k, v) -> e.put(k, v ?: JSONObject.NULL) }; break }
            }
        }
    }

    /** The upload of [clientId] became a note */
    fun noteSaved(ctx: Context, clientId: String?, noteId: String?, title: String?) {
        if (clientId.isNullOrBlank()) return
        edit(ctx) { list ->
            for (i in list.length() - 1 downTo 0) {
                val e = list.getJSONObject(i)
                if (e.optString("clientId") == clientId) {
                    e.put("noteId", noteId ?: JSONObject.NULL).put("title", title?.take(80) ?: JSONObject.NULL).put("result", "saved")
                    break
                }
            }
        }
    }

    /** The trigger label for an upload (sent to the server with the recording) */
    fun triggerFor(ctx: Context, clientId: String): String? {
        val list = read(ctx)
        for (i in list.length() - 1 downTo 0) {
            val e = list.getJSONObject(i)
            if (e.optString("clientId") == clientId) return e.optString("trigger").takeIf { it.isNotBlank() }
        }
        return if (clientId.startsWith("watch-")) "Watch" else null
    }

    /** An entry from the watch (/pa/rec-log) */
    fun fromWatch(ctx: Context, e: JSONObject) {
        e.put("device", "watch")
        if (!e.has("trigger")) e.put("trigger", label(WATCH + ":" + e.optString("source"), null))
        if (!e.has("id")) e.put("id", UUID.randomUUID().toString().take(8))
        edit(ctx) { list ->
            for (i in 0 until list.length()) {
                if (list.getJSONObject(i).optString("id") == e.optString("id")) {
                    val old = list.getJSONObject(i)
                    e.keys().forEach { k -> old.put(k, e.get(k)) }
                    return@edit
                }
            }
            list.put(e)
        }
    }

    /** Newest first */
    fun recent(ctx: Context, limit: Int = 20): JSONArray {
        val list = read(ctx)
        val out = JSONArray()
        for (i in list.length() - 1 downTo maxOf(0, list.length() - limit)) out.put(list.get(i))
        return out
    }

    fun clear(ctx: Context) = prefs(ctx).edit().remove("list").apply()

    private fun read(ctx: Context): JSONArray =
        runCatching { JSONArray(prefs(ctx).getString("list", "[]")) }.getOrDefault(JSONArray())

    private fun add(ctx: Context, e: JSONObject) = edit(ctx) { it.put(e) }

    private fun edit(ctx: Context, change: (JSONArray) -> Unit) = synchronized(lock) {
        val list = read(ctx)
        change(list)
        val trimmed = if (list.length() > MAX) JSONArray().also { t -> for (i in list.length() - MAX until list.length()) t.put(list.get(i)) } else list
        prefs(ctx).edit().putString("list", trimmed.toString()).apply()
    }
}
