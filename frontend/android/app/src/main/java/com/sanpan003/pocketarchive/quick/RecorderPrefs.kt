package com.sanpan003.pocketarchive.quick

import android.content.Context
import org.json.JSONObject

/**
 * Settings → Recording & shortcuts, stored on this phone only (not shared
 * with the web or the watch). Read by the recorder service, the activity
 * key handler, launch entries and the accessibility shortcut.
 */
object RecorderPrefs {
    private const val PREFS = "recorder_settings"

    // Values (strings so the web layer can show them as-is)
    const val STOP = "stop"
    const val IGNORE = "ignore"
    const val DISCARD = "discard"
    const val NEW = "new"

    data class Settings(
        val preset: String = "upStartStop",      // upStartStop | upStartDownStop | custom
        val volumeUp: String = STOP,             // stop | ignore
        val volumeDown: String = STOP,           // stop | discard | ignore
        val longPressDownDiscard: Boolean = false,
        val quickRecordWhileRecording: String = STOP, // stop | ignore | new
        val silenceSec: Int = 4,                 // 0 = off
        val maxMinutes: Int = 2,
        val feedback: String = "both",           // both | vibrate | chime | none
        val countdown: Boolean = false,
        val guardSec: Int = 3,                   // ignore start requests this long after a stop (2–5)
        val doublePressUpStart: Boolean = false, // accessibility shortcut
        val doublePressDownStop: Boolean = false,
        // Accidental recordings
        val pocketDetection: Boolean = true,     // proximity NEAR + screen off at launch → don't record
        val noSpeechDiscard: Boolean = true,     // no speech in the first noSpeechSec → discard (Restore 30 s)
        val noSpeechSec: Int = 4,                // 3 | 4 | 6
        val minLengthDiscard: Boolean = true,    // shorter than 2 s → discard (Restore 30 s)
        val confirmStart: Boolean = false,       // "Press again to confirm" after an outside start
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("preset", preset).put("volumeUp", volumeUp).put("volumeDown", volumeDown)
            .put("longPressDownDiscard", longPressDownDiscard).put("quickRecordWhileRecording", quickRecordWhileRecording)
            .put("silenceSec", silenceSec).put("maxMinutes", maxMinutes).put("feedback", feedback)
            .put("countdown", countdown).put("guardSec", guardSec)
            .put("doublePressUpStart", doublePressUpStart).put("doublePressDownStop", doublePressDownStop)
            .put("pocketDetection", pocketDetection).put("noSpeechDiscard", noSpeechDiscard).put("noSpeechSec", noSpeechSec)
            .put("minLengthDiscard", minLengthDiscard).put("confirmStart", confirmStart)

        /** Any volume key does something while recording → capture the keys */
        val capturesKeys get() = volumeUp != IGNORE || volumeDown != IGNORE || longPressDownDiscard
    }

    private val SILENCE = setOf(0, 3, 4, 6, 10)
    private val MAX = setOf(1, 2, 5, 10)
    private val NO_SPEECH = setOf(3, 4, 6)

    /** Merge a (partial) JSON object from the web layer onto the current settings, validated. */
    fun merge(current: Settings, o: JSONObject): Settings {
        fun str(key: String, allowed: Set<String>, def: String) =
            o.optString(key, def).takeIf { it in allowed } ?: def
        var s = current.copy(
            preset = str("preset", setOf("upStartStop", "upStartDownStop", "custom"), current.preset),
            volumeUp = str("volumeUp", setOf(STOP, IGNORE), current.volumeUp),
            volumeDown = str("volumeDown", setOf(STOP, DISCARD, IGNORE), current.volumeDown),
            longPressDownDiscard = o.optBoolean("longPressDownDiscard", current.longPressDownDiscard),
            quickRecordWhileRecording = str("quickRecordWhileRecording", setOf(STOP, IGNORE, NEW), current.quickRecordWhileRecording),
            silenceSec = o.optInt("silenceSec", current.silenceSec).takeIf { it in SILENCE } ?: current.silenceSec,
            maxMinutes = o.optInt("maxMinutes", current.maxMinutes).takeIf { it in MAX } ?: current.maxMinutes,
            feedback = str("feedback", setOf("both", "vibrate", "chime", "none"), current.feedback),
            countdown = o.optBoolean("countdown", current.countdown),
            guardSec = o.optInt("guardSec", current.guardSec).coerceIn(2, 5),
            doublePressUpStart = o.optBoolean("doublePressUpStart", current.doublePressUpStart),
            doublePressDownStop = o.optBoolean("doublePressDownStop", current.doublePressDownStop),
            pocketDetection = o.optBoolean("pocketDetection", current.pocketDetection),
            noSpeechDiscard = o.optBoolean("noSpeechDiscard", current.noSpeechDiscard),
            noSpeechSec = o.optInt("noSpeechSec", current.noSpeechSec).takeIf { it in NO_SPEECH } ?: current.noSpeechSec,
            minLengthDiscard = o.optBoolean("minLengthDiscard", current.minLengthDiscard),
            confirmStart = o.optBoolean("confirmStart", current.confirmStart),
        )
        // Presets only set the volume keys; everything else stays as chosen
        if (o.has("preset") && o.optString("preset") != current.preset) {
            s = when (s.preset) {
                "upStartStop" -> s.copy(volumeUp = STOP, volumeDown = STOP)
                "upStartDownStop" -> s.copy(volumeUp = IGNORE, volumeDown = STOP)
                else -> s
            }
        } else if (o.has("volumeUp") || o.has("volumeDown")) {
            s = s.copy(preset = when {
                s.volumeUp == STOP && s.volumeDown == STOP -> "upStartStop"
                s.volumeUp == IGNORE && s.volumeDown == STOP -> "upStartDownStop"
                else -> "custom"
            })
        }
        return s
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Volatile private var cached: Settings? = null

    fun get(ctx: Context): Settings {
        cached?.let { return it }
        val raw = prefs(ctx).getString("json", null)
        val s = if (raw != null) runCatching { merge(Settings(), JSONObject(raw)) }.getOrDefault(Settings()) else migrated(ctx)
        cached = s
        return s
    }

    fun save(ctx: Context, s: Settings) {
        cached = s
        prefs(ctx).edit().putString("json", s.toJson().toString()).apply()
    }

    fun update(ctx: Context, patch: JSONObject): Settings = merge(get(ctx), patch).also { save(ctx, it) }

    /** First run on 1.1.0: keep what the old switches said */
    private fun migrated(ctx: Context): Settings {
        var s = Settings()
        if (!TokenStore.volumeStop(ctx)) s = s.copy(volumeDown = IGNORE, volumeUp = IGNORE, preset = "custom")
        if (!TokenStore.launcherToggle(ctx)) s = s.copy(quickRecordWhileRecording = IGNORE)
        save(ctx, s)
        return s
    }
}
