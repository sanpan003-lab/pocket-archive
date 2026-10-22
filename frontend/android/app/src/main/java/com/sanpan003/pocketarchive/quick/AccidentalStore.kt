package com.sanpan003.pocketarchive.quick

import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.R
import org.json.JSONArray
import java.io.File

/**
 * Settings → Recording & shortcuts → Accidental recordings: the safety net. Every auto-discard
 * (no speech, too short) keeps the audio for 30 seconds with "Ignored accidental recording · Restore";
 * Restore saves it as a normal capture. Never silently deletes real speech. Also counts what was
 * ignored this week, and blocks new starts for 3 seconds after something was ignored.
 */
object AccidentalStore {
    private const val TAG = "Accidental"
    const val KEEP_MS = 30_000L
    const val COOLDOWN_MS = 3_000L
    private const val ID_IGNORED = 1004
    private const val PREFS = "accidental"
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var lastIgnoredAt = 0L

    private fun dir(ctx: Context) = File(ctx.filesDir, "quick_ignored").apply { mkdirs() }

    /** A start trigger within 3 s after something was ignored: ignore it too (still in the pocket) */
    fun inCooldown(): Boolean = lastIgnoredAt > 0 && SystemClock.elapsedRealtime() - lastIgnoredAt < COOLDOWN_MS

    /**
     * Something was ignored. [recording] (null for a blocked start) is kept for 30 s with Restore.
     * reason: "pocket" | "no-speech" | "too-short" | "confirm"
     */
    fun ignore(ctx: Context, recording: File?, reason: String, text: String) {
        val app = ctx.applicationContext
        lastIgnoredAt = SystemClock.elapsedRealtime()
        count(app)
        RecorderGuard.note("Ignored ($reason): $text")
        if (recording == null || !recording.exists() || recording.length() == 0L) { recording?.delete(); return }
        val kept = File(dir(app), recording.name)
        if (!recording.renameTo(kept)) { recording.copyTo(kept, overwrite = true); recording.delete() }
        notify(app, kept, text)
        main.postDelayed({
            if (kept.exists()) kept.delete()
            NotificationManagerCompat.from(app).cancel(ID_IGNORED)
        }, KEEP_MS)
    }

    /** Restore: upload it like any other recording */
    fun restore(ctx: Context, name: String): Boolean {
        val f = File(dir(ctx), File(name).name)
        NotificationManagerCompat.from(ctx).cancel(ID_IGNORED)
        if (!f.exists()) return false
        Log.i(TAG, "Restored ${f.name}")
        UploadWorker.enqueue(ctx, PendingStore.moveToPending(ctx, f))
        WidgetState.uploading(ctx)
        return true
    }

    /** The app's "Restore" (in-app toast): the newest one still kept */
    fun restoreLatest(ctx: Context): Boolean {
        val newest = dir(ctx).listFiles()?.maxByOrNull { it.lastModified() } ?: return false
        return restore(ctx, newest.name)
    }

    /** Kept files whose 30 s ran out while the process was gone */
    fun cleanup(ctx: Context) {
        val cutoff = System.currentTimeMillis() - KEEP_MS * 2
        dir(ctx).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun count(ctx: Context) {
        val week = System.currentTimeMillis() - 7 * 86_400_000L
        val list = JSONArray()
        times(ctx).filter { it > week }.forEach { list.put(it) }
        list.put(System.currentTimeMillis())
        prefs(ctx).edit().putString("times", list.toString()).apply()
    }

    private fun times(ctx: Context): List<Long> = runCatching {
        val a = JSONArray(prefs(ctx).getString("times", "[]"))
        (0 until a.length()).map { a.getLong(it) }
    }.getOrDefault(emptyList())

    /** "12 accidental recordings ignored this week" */
    fun weekCount(ctx: Context): Int {
        val week = System.currentTimeMillis() - 7 * 86_400_000L
        return times(ctx).count { it > week }
    }

    private fun notify(ctx: Context, kept: File, text: String) {
        val restore = PendingIntent.getBroadcast(
            ctx, 8,
            Intent(ctx, AccidentalRestoreReceiver::class.java).putExtra(AccidentalRestoreReceiver.EXTRA_FILE, kept.name),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        Notifications.ensureChannels(ctx)
        val n = NotificationCompat.Builder(ctx, Notifications.CH_RESULT_SILENT)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.GREY)
            .setContentTitle("Ignored accidental recording")
            .setContentText("$text · Restore to keep it")
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setTimeoutAfter(KEEP_MS)
            .setAutoCancel(true)
            .setContentIntent(restore)
            .addAction(0, "Restore", restore)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_IGNORED, n) } catch (_: SecurityException) { /* notifications off */ }
    }
}

class AccidentalRestoreReceiver : BroadcastReceiver() {
    companion object { const val EXTRA_FILE = "file" }

    override fun onReceive(ctx: Context, intent: Intent) {
        intent.getStringExtra(EXTRA_FILE)?.let { AccidentalStore.restore(ctx, it) }
    }
}

/**
 * Pocket detection: the proximity sensor reads NEAR (something right on it) while the screen is off,
 * locked, or was only just switched on by the key press. One reading, at most ~0.5 s.
 */
object PocketCheck {
    @Volatile private var screenOnAt = 0L
    private var watching = false

    /** Remember when the screen came on (a side-key press in a pocket wakes it) */
    fun watchScreen(ctx: Context) {
        if (watching) return
        watching = true
        runCatching {
            ctx.applicationContext.registerReceiver(object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) { screenOnAt = SystemClock.elapsedRealtime() }
            }, IntentFilter(Intent.ACTION_SCREEN_ON))
        }
    }

    /** How long ago the screen came on (null: not known — the process started after that) */
    fun screenOnAgoMs(): Long? = if (screenOnAt > 0) SystemClock.elapsedRealtime() - screenOnAt else null

    /** Screen off, locked, or woken in the last 4 s (or the app was just started by the press) */
    fun screenOffOrJustWoken(ctx: Context): Boolean {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val km = ctx.getSystemService(KeyguardManager::class.java)
        val now = SystemClock.elapsedRealtime()
        val coldStart = now - Process.getStartElapsedRealtime() < 5_000
        return pm?.isInteractive == false || km?.isKeyguardLocked == true || now - screenOnAt < 4_000 || coldStart
    }

    /** → near (true) / far or no sensor (false), after at most [timeoutMs] */
    fun isNear(ctx: Context, timeoutMs: Long = 500, done: (Boolean) -> Unit) = read(ctx, timeoutMs) { _, near -> done(near) }

    /** → (reading in cm or null, near) after at most [timeoutMs] */
    fun read(ctx: Context, timeoutMs: Long = 500, done: (Float?, Boolean) -> Unit) {
        val sm = ctx.getSystemService(SensorManager::class.java)
        val sensor = sm?.getDefaultSensor(Sensor.TYPE_PROXIMITY)
        if (sm == null || sensor == null) { done(null, false); return }
        val main = Handler(Looper.getMainLooper())
        var finished = false
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                if (finished) return
                finished = true
                sm.unregisterListener(this)
                // Most sensors report 0 (near) or their maximum (far)
                done(e.values[0], e.values[0] < minOf(sensor.maximumRange, 5f))
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) = Unit
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST, main)
        main.postDelayed({ if (!finished) { finished = true; sm.unregisterListener(listener); done(null, false) } }, timeoutMs)
    }
}
