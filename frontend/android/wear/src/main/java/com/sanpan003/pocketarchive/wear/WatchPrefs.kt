package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * The watch's "while recording" settings, stored on the watch. Edited here
 * (watch Settings page) or on the phone (Settings → Recording & shortcuts →
 * Galaxy Watch); newest updatedAt wins.
 */
object WatchPrefs {
    data class Settings(
        val quickRecordWhileRecording: String = "stop", // Quick Record / tile / complication while recording: stop | ignore | new
        val silenceSec: Int = 4,                        // 0 = off
        val maxMinutes: Int = 2,
        val feedback: String = "vibrate",               // vibrate | none
        val countdown: Boolean = false,
        val guardSec: Int = 3,
        val updatedAt: Long = 0,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("quickRecordWhileRecording", quickRecordWhileRecording).put("silenceSec", silenceSec)
            .put("maxMinutes", maxMinutes).put("feedback", feedback).put("countdown", countdown)
            .put("guardSec", guardSec).put("updatedAt", updatedAt)
    }

    val SILENCE = listOf(0, 3, 4, 6, 10)
    val MAX = listOf(1, 2, 5, 10)

    private const val PREFS = "watch_rec_settings"
    private val _settings = MutableStateFlow(Settings())
    val settings: StateFlow<Settings> = _settings.asStateFlow()
    private var loaded = false

    fun get(ctx: Context): Settings {
        if (!loaded) {
            loaded = true
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("json", null)?.let { raw ->
                runCatching { _settings.value = parse(JSONObject(raw), Settings()) }
            }
        }
        return _settings.value
    }

    private fun parse(o: JSONObject, base: Settings) = base.copy(
        quickRecordWhileRecording = o.optString("quickRecordWhileRecording", base.quickRecordWhileRecording).takeIf { it in setOf("stop", "ignore", "new") } ?: base.quickRecordWhileRecording,
        silenceSec = o.optInt("silenceSec", base.silenceSec).takeIf { it in SILENCE } ?: base.silenceSec,
        maxMinutes = o.optInt("maxMinutes", base.maxMinutes).takeIf { it in MAX } ?: base.maxMinutes,
        feedback = o.optString("feedback", base.feedback).takeIf { it == "vibrate" || it == "none" } ?: base.feedback,
        countdown = o.optBoolean("countdown", base.countdown),
        guardSec = o.optInt("guardSec", base.guardSec).coerceIn(2, 5),
        updatedAt = o.optLong("updatedAt", base.updatedAt),
    )

    private fun save(ctx: Context, s: Settings) {
        _settings.value = s
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("json", s.toJson().toString()).apply()
    }

    /** Changed on the watch → store and tell the phone */
    fun edit(ctx: Context, change: (Settings) -> Settings) {
        val next = change(get(ctx)).copy(updatedAt = System.currentTimeMillis())
        save(ctx, next)
        val req = PutDataMapRequest.create(Protocol.DATA_REC_SETTINGS_WATCH).apply {
            dataMap.putString("json", next.toJson().toString())
            dataMap.putLong("updatedAt", next.updatedAt)
        }.asPutDataRequest().setUrgent()
        Wearable.getDataClient(ctx).putDataItem(req).addOnFailureListener { Log.w("WatchPrefs", "Not sent: ${it.message}") }
    }

    /** Changed on the phone */
    fun fromPhone(ctx: Context, json: String?) {
        val o = runCatching { JSONObject(json ?: return) }.getOrNull() ?: return
        val cur = get(ctx)
        if (o.optLong("updatedAt") <= cur.updatedAt) return
        save(ctx, parse(o, cur))
    }

    // ── Double-action guards (same as the phone) ───────────────────────────
    const val STOP_GRACE_MS = 1_500L
    @Volatile var lastStartAt = 0L
    @Volatile var lastStopAt = 0L

    fun started() { lastStartAt = SystemClock.elapsedRealtime() }
    fun stopped() { lastStopAt = SystemClock.elapsedRealtime() }
    fun justStopped(ctx: Context) = lastStopAt > 0 && SystemClock.elapsedRealtime() - lastStopAt < get(ctx).guardSec * 1000L
    fun justStarted() = SystemClock.elapsedRealtime() - lastStartAt < STOP_GRACE_MS
}
