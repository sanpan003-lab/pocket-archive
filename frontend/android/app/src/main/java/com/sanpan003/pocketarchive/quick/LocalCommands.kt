package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import kotlin.concurrent.thread

/**
 * Quick commands that never depend on the server (2.13.0): "timer 10 minutes", "set an alarm for 6:30",
 * "wake me at 5", "remind me in 20 minutes". When a recording is saved (phone, or the one the watch sent),
 * it is also read by the on-device recognizer (LocalSpeech) and parsed locally (QuickCommandParser);
 * a command is run at once (Clock intent / local alarm) and the recording is still uploaded as a normal note.
 * [CommandClaims] makes sure the server's later answer doesn't run it a second time. If a command can't be set,
 * it says so loudly (notification + strong vibration) with Retry / Set manually / Open Clock.
 */
object LocalCommands {
    private const val TAG = "LocalCommands"
    private const val PREFS = "quick_commands"
    private const val ID_FAILED = 1012
    const val SOURCE_LOCAL = "local"
    const val SOURCE_SERVER = "server"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", true)
    fun speak(ctx: Context) = prefs(ctx).getBoolean("speak", false)
    fun setEnabled(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("enabled", on).apply()
    fun setSpeak(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("speak", on).apply()

    // ── who runs a command: local fast path or the server's answer ─────────

    private class PrefsStore(private val ctx: Context) : CommandClaims.Store {
        override fun get(key: String): String? = prefs(ctx).getString("c_$key", null)
        override fun put(key: String, value: String) {
            val p = prefs(ctx)
            val e = p.edit().putString("c_$key", value).putLong("t_$key", System.currentTimeMillis())
            val cutoff = System.currentTimeMillis() - 24 * 3600_000L // forget claims after a day
            p.all.keys.filter { it.startsWith("t_") && (p.getLong(it, 0) < cutoff) }.forEach { e.remove(it).remove("c_" + it.removePrefix("t_")) }
            e.apply()
        }
    }

    fun claims(ctx: Context) = CommandClaims(PrefsStore(ctx))

    // ── log: what happened to each quick command (no spoken text) ──────────

    private fun log(ctx: Context, source: String, outcome: String, since: Long? = null, kind: String? = null) {
        val ms = since?.let { SystemClock.elapsedRealtime() - it }
        Log.i(TAG, "$source $outcome ${kind ?: ""} ${ms ?: ""}ms")
        runCatching {
            val arr = JSONArray(prefs(ctx).getString("log", "[]"))
            val e = JSONObject().put("t", System.currentTimeMillis()).put("src", source).put("out", outcome)
            if (kind != null) e.put("kind", kind)
            if (ms != null) e.put("ms", ms)
            val next = JSONArray().put(e)
            for (i in 0 until minOf(arr.length(), 29)) next.put(arr.get(i))
            prefs(ctx).edit().putString("log", next.toString()).apply()
        }
    }

    fun logJson(ctx: Context): JSONArray = runCatching { JSONArray(prefs(ctx).getString("log", "[]")) }.getOrDefault(JSONArray())

    // ── entry point: a recording was saved ─────────────────────────────────

    /** [source]: "phone" or "watch". Returns at once; the work happens on its own thread. */
    fun analyze(ctx: Context, file: File, source: String) {
        val app = ctx.applicationContext
        if (!enabled(app) || !file.exists() || file.length() > 400_000) return
        val clientId = runCatching { PendingStore.meta(file).clientId }.getOrDefault("")
        // Copy now: the upload may delete the recording before we've decoded it
        val copy = runCatching { File.createTempFile("cmd", ".m4a", app.cacheDir).also { file.copyTo(it, overwrite = true) } }.getOrNull() ?: return
        val t0 = SystemClock.elapsedRealtime()
        thread(name = "quick-command") {
            val pcm = try { LocalSpeech.decode(copy) } finally { copy.delete() }
            if (pcm == null) { log(app, source, "not short audio"); return@thread }
            if (!LocalSpeech.available(app)) { log(app, source, "no on-device recognizer"); return@thread }
            LocalSpeech.recognize(app, pcm) { text -> thread { handle(app, text, clientId, source, t0) } }
        }
    }

    private fun handle(ctx: Context, text: String?, clientId: String, source: String, t0: Long) {
        if (text.isNullOrBlank()) { log(ctx, source, "nothing recognized", t0); return }
        val now = Calendar.getInstance()
        when (val parsed = QuickCommandParser.parse(text, now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE))) {
            is QuickCommandParser.Parse.None -> log(ctx, source, "not a command", t0)
            is QuickCommandParser.Parse.Unclear -> {
                log(ctx, source, "unclear ${parsed.kind}", t0, parsed.kind)
                Feedback.warning(ctx)
                failure(ctx, parsed.kind, null, "I heard a ${parsed.kind} command but not the time")
            }
            is QuickCommandParser.Parse.Ok -> run(ctx, parsed.command, clientId, source, t0)
        }
    }

    // ── running a command ──────────────────────────────────────────────────

    fun run(ctx: Context, cmd: QuickCommandParser.Command, clientId: String, source: String, t0: Long) {
        val kind = when (cmd) {
            is QuickCommandParser.Command.Timer -> "timer"
            is QuickCommandParser.Command.Alarm -> "alarm"
            is QuickCommandParser.Command.Reminder -> "reminder"
            QuickCommandParser.Command.Stopwatch -> "stopwatch"
        }
        val claims = claims(ctx)
        if (kind != "stopwatch" && !claims.claim(clientId, SOURCE_LOCAL)) { log(ctx, source, "server ran it first", t0, kind); return }
        val ok = try {
            when (cmd) {
                is QuickCommandParser.Command.Timer -> runTimer(ctx, cmd, clientId)
                is QuickCommandParser.Command.Alarm -> runAlarm(ctx, cmd, clientId)
                is QuickCommandParser.Command.Reminder -> runReminder(ctx, cmd, clientId)
                QuickCommandParser.Command.Stopwatch -> runStopwatch(ctx)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Quick command failed", e)
            null
        }
        if (ok == null) {
            claims.release(clientId, SOURCE_LOCAL) // the server's copy may still manage it
            log(ctx, source, "failed", t0, kind)
            Feedback.warning(ctx)
            failure(ctx, kind, commandJson(cmd), "Couldn't set your $kind")
        } else {
            log(ctx, source, "set", t0, kind)
            confirm(ctx, ok)
        }
    }

    private fun commandJson(cmd: QuickCommandParser.Command): JSONObject = when (cmd) {
        is QuickCommandParser.Command.Timer -> JSONObject().put("kind", "timer").put("seconds", cmd.seconds).put("label", cmd.label ?: "")
        is QuickCommandParser.Command.Alarm -> JSONObject().put("kind", "alarm").put("hour", cmd.hour).put("minute", cmd.minute)
            .put("label", cmd.label ?: "").put("repeat", JSONArray(cmd.repeat))
        is QuickCommandParser.Command.Reminder -> JSONObject().put("kind", "reminder").put("text", cmd.text)
            .put("delayMs", cmd.delayMs ?: -1L).put("hour", cmd.hour ?: -1).put("minute", cmd.minute ?: -1)
        QuickCommandParser.Command.Stopwatch -> JSONObject().put("kind", "stopwatch")
    }

    /** The confirmation text, or null when it couldn't be set */
    private fun runTimer(ctx: Context, cmd: QuickCommandParser.Command.Timer, clientId: String): String? {
        val what = "Timer · ${PhoneActions.durationText(cmd.seconds)}"
        if (PhoneActions.canStartNow(ctx)) {
            val out = PhoneActions.run(ctx, commandJson(cmd))
            return when (out.optString("status")) {
                "done" -> "⏲ $what set"
                "tap" -> { Feedback.warning(ctx); "⏲ Tap the notification to start: $what" }
                else -> null
            }
        }
        // The Clock app can't be opened from the background here: our own alarm rings at the end instead
        val id = "timer-" + clientId.ifBlank { System.currentTimeMillis().toString() }
        ReminderAlarms.schedule(
            ctx,
            ReminderAlarms.Reminder(id, "Timer finished", "Your ${PhoneActions.durationText(cmd.seconds)} timer is up", System.currentTimeMillis() + cmd.seconds * 1000L, "timer"),
            "Quick command: timer",
        )
        return if (ReminderAlarms.status(ctx, id).optString("state") in setOf("set", "approx")) "⏲ $what set (in Pocket Archive)" else null
    }

    private fun runAlarm(ctx: Context, cmd: QuickCommandParser.Command.Alarm, clientId: String): String? {
        val label = "Alarm · ${clock(cmd.hour, cmd.minute)}"
        if (PhoneActions.canStartNow(ctx) || cmd.repeat.isNotEmpty()) {
            val out = PhoneActions.run(ctx, commandJson(cmd))
            return when (out.optString("status")) {
                "done" -> "⏰ $label set"
                "tap" -> { Feedback.warning(ctx); "⏰ Tap the notification to set: $label" }
                else -> null
            }
        }
        val id = "alarm-" + clientId.ifBlank { System.currentTimeMillis().toString() }
        ReminderAlarms.schedule(ctx, ReminderAlarms.Reminder(id, "Alarm", label, nextOccurrence(cmd.hour, cmd.minute), "timer"), "Quick command: alarm")
        return if (ReminderAlarms.status(ctx, id).optString("state") in setOf("set", "approx")) "⏰ $label set (in Pocket Archive)" else null
    }

    private fun runReminder(ctx: Context, cmd: QuickCommandParser.Command.Reminder, clientId: String): String? {
        if (!ReminderAlarms.enabled(ctx)) return null
        val at = cmd.delayMs?.let { System.currentTimeMillis() + it } ?: nextOccurrence(cmd.hour ?: return null, cmd.minute ?: 0)
        val id = "local-" + clientId.ifBlank { System.currentTimeMillis().toString() }
        // clientId lets the server's own note (same recording) replace this entry instead of doubling the alert
        ReminderAlarms.schedule(ctx, ReminderAlarms.Reminder(id, cmd.text, cmd.text, at, "reminder", clientId.ifBlank { null }), "Quick command: reminder")
        if (ReminderAlarms.status(ctx, id).optString("state") !in setOf("set", "approx")) return null
        val inText = cmd.delayMs?.let { "in ${PhoneActions.durationText((it / 1000).toInt())}" } ?: "at ${clock(cmd.hour ?: 0, cmd.minute ?: 0)}"
        return "🔔 Reminder set · $inText"
    }

    private fun runStopwatch(ctx: Context): String? {
        val i = PhoneActions.clockLaunchIntent(ctx, "stopwatch") ?: return null
        if (!PhoneActions.canStartNow(ctx)) return null
        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return "⏱ Opened Clock — start the stopwatch"
    }

    private fun nextOccurrence(hour: Int, minute: Int): Long {
        val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        if (c.timeInMillis <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    private fun clock(h: Int, m: Int) = "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"

    // ── confirmation ───────────────────────────────────────────────────────

    fun confirm(ctx: Context, text: String) {
        Feedback.success(ctx)
        Handler(Looper.getMainLooper()).post { Toast.makeText(ctx.applicationContext, text, Toast.LENGTH_LONG).show() }
        if (speak(ctx)) speakText(ctx, text.replace(Regex("^[^A-Za-z0-9]+"), "").replace("·", ","))
    }

    private fun speakText(ctx: Context, text: String) {
        var tts: TextToSpeech? = null
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                    override fun onStart(id: String?) {}
                    override fun onDone(id: String?) { tts?.shutdown() }
                    @Deprecated("Deprecated in Java") override fun onError(id: String?) { tts?.shutdown() }
                })
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pa-confirm")
            } else tts?.shutdown()
        }
    }

    // ── never fail silently ────────────────────────────────────────────────

    /** Strong, repeated vibration, whatever the app's feedback setting says */
    fun strongBuzz(ctx: Context) {
        runCatching {
            val v = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(VibratorManager::class.java).defaultVibrator
            else @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java)
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 200, 600, 200, 900), intArrayOf(0, 255, 0, 255, 0, 255), -1))
        }
    }

    /**
     * "Couldn't set your timer": high priority + strong vibration, with Retry (when we have the command),
     * Set manually (number picker) and Open Clock. Bridged to a paired watch like any notification.
     */
    fun failure(ctx: Context, kind: String, command: JSONObject?, reason: String) {
        Notifications.ensureChannels(ctx)
        strongBuzz(ctx)
        val what = when (kind) { "alarm" -> "alarm"; "reminder" -> "reminder"; "stopwatch" -> "stopwatch"; else -> "timer" }
        val json = command?.toString() ?: ""
        fun activity(mode: String, code: Int) = PendingIntent.getActivity(
            ctx, code,
            Intent(ctx, CommandActivity::class.java).putExtra(CommandActivity.EXTRA_MODE, mode).putExtra(CommandActivity.EXTRA_KIND, kind)
                .putExtra(CommandActivity.EXTRA_JSON, json).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val clock = PhoneActions.clockLaunchIntent(ctx, kind)?.let {
            PendingIntent.getActivity(ctx, 7003, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val b = NotificationCompat.Builder(ctx, Notifications.CH_COMMAND_FAILED)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.AMBER)
            .setContentTitle("⚠ Couldn't set your $what")
            .setContentText(reason)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$reason. Retry, set it by hand, or open Clock."))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(longArrayOf(0, 600, 200, 600, 200, 900))
            .setAutoCancel(true)
            .setContentIntent(activity("manual", 7002))
        if (command != null) b.addAction(0, "Retry", activity("retry", 7001))
        b.addAction(0, "Set manually", activity("manual", 7002))
        if (clock != null) b.addAction(0, "Open Clock", clock)
        try { NotificationManagerCompat.from(ctx).notify(ID_FAILED, b.build()) } catch (_: SecurityException) { /* notifications off */ }
    }
}
