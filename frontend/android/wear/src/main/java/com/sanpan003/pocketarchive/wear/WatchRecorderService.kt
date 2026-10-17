package com.sanpan003.pocketarchive.wear

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.File
import kotlin.math.max
import kotlin.math.min

/**
 * Records AAC/.m4a in a microphone foreground service (keeps going when the
 * screen dims). Stops on tap, after 4 s of silence, or at 2 minutes — same
 * as the phone — then queues the file for the phone.
 */
class WatchRecorderService : Service() {

    companion object {
        private const val TAG = "WatchRecorder"
        private const val ACTION_START = "start"
        private const val ACTION_STOP = "stop"
        private const val POLL_MS = 200L
        private const val COUNTDOWN_MS = 900L
        private const val GRACE_MS = 700L
        private const val MIN_THRESHOLD = 1_500.0

        /** Only from the foreground (activity): Android requires it for microphone services. */
        fun start(ctx: Context) {
            if (WatchState.isRecording) return
            ContextCompat.startForegroundService(ctx, Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_START))
        }

        /** "Start a new note": save this one, start the next */
        fun restart(ctx: Context) {
            stop(ctx)
            ContextCompat.startForegroundService(ctx, Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_START))
        }

        fun stop(ctx: Context) {
            if (!WatchState.isRecording) return
            ctx.startService(Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_STOP))
        }

        fun toggle(ctx: Context) = if (WatchState.isRecording) stop(ctx) else start(ctx)
    }

    private val main = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedElapsed = 0L
    private var lastVoiceElapsed = 0L
    private var heardVoice = false
    private var noiseFloor = 400.0
    private var starting = false
    private var silenceMs = 4_000L
    private var maxMs = 120_000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> if (recorder == null && !starting) startRecording() else Unit
            ACTION_STOP -> if (starting) { main.removeCallbacks(begin); starting = false; finish() } else stopRecording()
            else -> if (recorder == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRecording() {
        WatchNotifications.ensureChannels(this)
        try {
            ServiceCompat.startForeground(this, WatchNotifications.ID_RECORDING, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } catch (e: Exception) {
            Log.w(TAG, "Could not start recording in the foreground", e)
            ResultPresenter.show(this, org.json.JSONObject().put("icon", "⚠️").put("text", "Couldn't start recording").put("tone", "review"))
            stopSelf()
            return
        }
        val prefs = WatchPrefs.get(this)
        silenceMs = if (prefs.silenceSec > 0) prefs.silenceSec * 1000L else Long.MAX_VALUE
        maxMs = prefs.maxMinutes * 60_000L
        if (prefs.countdown) {
            starting = true
            Haptics.countdown(this)
            main.postDelayed(begin, COUNTDOWN_MS)
        } else beginRecording()
    }

    private val begin = Runnable { starting = false; beginRecording() }

    private fun beginRecording() {
        val output = CaptureQueue.newRecording(this)
        val mr = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) MediaRecorder(this)
        else @Suppress("DEPRECATION") MediaRecorder()
        try {
            mr.setAudioSource(MediaRecorder.AudioSource.MIC)
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mr.setAudioEncodingBitRate(64_000)
            mr.setAudioSamplingRate(44_100)
            mr.setAudioChannels(1)
            mr.setOutputFile(output.absolutePath)
            mr.prepare()
            mr.start()
        } catch (e: Exception) {
            Log.w(TAG, "Microphone unavailable", e)
            mr.release()
            output.delete()
            ResultPresenter.show(this, org.json.JSONObject().put("icon", "⚠️").put("text", "Microphone is busy").put("tone", "review"))
            finish()
            return
        }
        recorder = mr
        file = output
        startedElapsed = SystemClock.elapsedRealtime()
        lastVoiceElapsed = startedElapsed
        heardVoice = false
        noiseFloor = 400.0
        WatchState.set(Phase.Recording(startedElapsed))
        WatchPrefs.started()
        Haptics.start(this)
        RecordTileService.requestUpdate(this)
        main.postDelayed(poll, POLL_MS)
    }

    private val poll = object : Runnable {
        override fun run() {
            val active = recorder ?: return
            val now = SystemClock.elapsedRealtime()
            val amp = try { active.maxAmplitude.toDouble() } catch (_: RuntimeException) { 0.0 }
            val threshold = max(MIN_THRESHOLD, noiseFloor * 2.5)
            if (amp > threshold) {
                if (now - startedElapsed > GRACE_MS) { lastVoiceElapsed = now; heardVoice = true }
            } else {
                noiseFloor = noiseFloor * 0.95 + amp * 0.05
            }
            WatchState.level(min(1.0, amp / 12_000.0).toFloat())
            when {
                now - startedElapsed >= maxMs -> stopRecording()
                now - lastVoiceElapsed >= silenceMs -> stopRecording()
                else -> main.postDelayed(this, POLL_MS)
            }
        }
    }

    private fun stopRecording() {
        val active = recorder ?: return finish()
        main.removeCallbacks(poll)
        recorder = null
        WatchPrefs.stopped()
        val clean = try { active.stop(); true } catch (_: RuntimeException) { false } finally { active.release() }
        val captured = file
        file = null
        Haptics.stop(this)
        WatchState.level(0f)

        if (!clean || captured == null || !heardVoice || captured.length() < 1_500) {
            captured?.delete()
            WatchState.set(Phase.Result("🎙️", "Didn't hear anything", "review", "Nothing was saved"))
        } else {
            CaptureQueue.enqueue(this, captured)
            WatchState.set(Phase.Sending)
            SendWorker.sendNow(this)
        }
        RecordTileService.requestUpdate(this)
        finish()
    }

    private fun finish() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        main.removeCallbacks(begin)
        recorder?.let { active ->
            // Killed mid-recording: keep what we have
            runCatching { active.stop() }
            active.release()
            recorder = null
            file?.let { if (heardVoice && it.length() > 1_500) { CaptureQueue.enqueue(this, it); SendWorker.sendNow(this) } else it.delete() }
            WatchState.set(Phase.Idle)
        }
        super.onDestroy()
    }

    private fun notification() = NotificationCompat.Builder(this, WatchNotifications.CH_RECORDING)
        .setSmallIcon(R.drawable.ic_stat_mic)
        .setColor(WatchNotifications.BRAND)
        .setContentTitle("Recording…")
        .setContentText("Tap to open")
        .setOngoing(true)
        .setUsesChronometer(true)
        .setWhen(System.currentTimeMillis())
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(WatchNotifications.openApp(this, 1))
        .addAction(R.drawable.ic_stop_white, "Stop", PendingIntent.getService(
            this, 2, Intent(this, WatchRecorderService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        .build()
}
