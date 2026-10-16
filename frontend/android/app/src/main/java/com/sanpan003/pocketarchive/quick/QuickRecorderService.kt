package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.media.VolumeProviderCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import com.sanpan003.pocketarchive.R
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * Records AAC/.m4a in a microphone foreground service, so recording keeps
 * going with the screen off or the phone locked. Stops on tap, after 4 s of
 * silence, or at 2 minutes; then uploads right away (still in the foreground)
 * and hands off to WorkManager if that fails.
 */
class QuickRecorderService : Service() {

    companion object {
        private const val TAG = "QuickRecorder"
        const val ACTION_START = "com.sanpan003.pocketarchive.recorder.START"
        const val ACTION_STOP = "com.sanpan003.pocketarchive.recorder.STOP"
        const val ACTION_DISCARD = "com.sanpan003.pocketarchive.recorder.DISCARD"
        private const val COUNTDOWN_MS = 900L

        private const val POLL_MS = 50L         // ~20 level updates a second for the live waveform
        private const val GRACE_MS = 700L        // ignore the start beep
        private const val MIN_THRESHOLD = 1_500.0 // getMaxAmplitude() is 0..32767

        fun intent(ctx: Context, action: String) =
            Intent(ctx, QuickRecorderService::class.java).setAction(action)
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedElapsed = 0L
    private var lastVoiceElapsed = 0L
    private var heardVoice = false
    private var noiseFloor = 400.0
    private var uploadsInFlight = 0
    private var starting = false      // countdown running
    private var silenceMs = 4_000L    // from Settings → Recording & shortcuts, read at start
    private var maxMs = 120_000L
    /** Captures the volume keys while recording (screen on or off); released on stop. */
    private var keySession: MediaSessionCompat? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> if (recorder == null && !starting) startRecording()
            ACTION_STOP -> if (starting) cancelCountdown() else stopRecording()
            ACTION_DISCARD -> if (starting) cancelCountdown() else stopRecording(discard = true)
            else -> if (recorder == null && uploadsInFlight == 0) stopSelf()
        }
        return START_NOT_STICKY
    }

    // ── Recording ──────────────────────────────────────────────────────────

    private fun startRecording() {
        // Enter the foreground first (Android requires it within seconds of startForegroundService)
        try {
            ServiceCompat.startForeground(
                this, Notifications.ID_RECORDING, recordingNotification(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not start foreground recording", e)
            ResultNotifier.failed(this, "Couldn't start recording — open the app and try again")
            stopSelf()
            return
        }

        val prefs = RecorderPrefs.get(this)
        silenceMs = if (prefs.silenceSec > 0) prefs.silenceSec * 1000L else Long.MAX_VALUE
        maxMs = prefs.maxMinutes * 60_000L
        if (prefs.countdown) {
            starting = true
            Feedback.countdown(this)
            main.postDelayed(beginAfterCountdown, COUNTDOWN_MS)
        } else {
            beginRecording()
        }
    }

    private val beginAfterCountdown = Runnable {
        starting = false
        beginRecording()
    }

    private fun cancelCountdown() {
        main.removeCallbacks(beginAfterCountdown)
        starting = false
        finishIfIdle()
    }

    private fun beginRecording() {
        val output = PendingStore.newFile(this)
        val mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            @Suppress("DEPRECATION") MediaRecorder()
        }
        try {
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mediaRecorder.setAudioEncodingBitRate(64_000)
            mediaRecorder.setAudioSamplingRate(44_100)
            mediaRecorder.setAudioChannels(1)
            mediaRecorder.setOutputFile(output.absolutePath)
            mediaRecorder.prepare()
            mediaRecorder.start()
        } catch (e: Exception) {
            Log.w(TAG, "Microphone unavailable", e)
            mediaRecorder.release()
            output.delete()
            ResultNotifier.failed(this, "Microphone is busy or unavailable")
            finishIfIdle()
            return
        }

        recorder = mediaRecorder
        file = output
        startedElapsed = SystemClock.elapsedRealtime()
        lastVoiceElapsed = startedElapsed
        heardVoice = false
        noiseFloor = 400.0
        RecorderGuard.started()
        RecorderState.update(this, true, System.currentTimeMillis())
        Feedback.recordingStarted(this)
        main.postDelayed(poll, POLL_MS)
        if (RecorderPrefs.get(this).capturesKeys) captureVolumeKeys()
    }

    // ── Volume keys: down = stop & upload, up = ignored ────────────────────

    /**
     * A remote-volume media session makes Android send the volume keys here
     * (not to the ringer/media volume) while it's active. It only exists
     * while recording, so a stray press later can never start anything.
     */
    private fun captureVolumeKeys() {
        releaseVolumeKeys()
        try {
            val provider = object : VolumeProviderCompat(VOLUME_CONTROL_RELATIVE, 100, 50) {
                override fun onAdjustVolume(direction: Int) {
                    when {
                        direction < 0 -> main.post { keyFromSession(RecorderKeys.Key.DOWN) }
                        direction > 0 -> main.post { keyFromSession(RecorderKeys.Key.UP) }
                    }
                }
                override fun onSetVolumeTo(volume: Int) {
                    if (volume < currentVolume) main.post { keyFromSession(RecorderKeys.Key.DOWN) }
                    else if (volume > currentVolume) main.post { keyFromSession(RecorderKeys.Key.UP) }
                }
            }
            keySession = MediaSessionCompat(this, "PocketArchiveRecorder").apply {
                setPlaybackToRemote(provider)
                setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                        .setActions(PlaybackStateCompat.ACTION_STOP)
                        .build()
                )
                setCallback(object : MediaSessionCompat.Callback() {
                    override fun onStop() = stopFromKey()
                })
                isActive = true
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "Volume keys unavailable", e)
            keySession = null
        }
    }

    private fun stopFromKey() {
        if (recorder == null) return // already stopped: no double stop
        Log.i(TAG, "Stopped with the media session")
        stopRecording()
    }

    /** Volume keys with the screen off / app in the background → Settings → Recording & shortcuts */
    private fun keyFromSession(key: RecorderKeys.Key) {
        if (recorder == null) return
        Log.i(TAG, "Volume key from the media session: $key")
        RecorderKeys.onKey(this, key)
    }

    private fun releaseVolumeKeys() {
        keySession?.let {
            runCatching { it.isActive = false; it.release() }
        }
        keySession = null
    }

    /** Mic level → silence detection (adaptive noise floor) + in-app pulse. */
    private val poll = object : Runnable {
        override fun run() {
            val active = recorder ?: return
            val now = SystemClock.elapsedRealtime()
            val amp = try { active.maxAmplitude.toDouble() } catch (_: RuntimeException) { 0.0 }
            val threshold = max(MIN_THRESHOLD, noiseFloor * 2.5)
            if (amp > threshold) {
                if (now - startedElapsed > GRACE_MS) {
                    lastVoiceElapsed = now
                    heardVoice = true
                }
            } else {
                noiseFloor = noiseFloor * 0.9875 + amp * 0.0125 // same ~4 s time constant at 50 ms polls
            }
            RecorderState.level(min(1.0, amp / 12_000.0))

            when {
                now - startedElapsed >= maxMs -> stopRecording()
                now - lastVoiceElapsed >= silenceMs -> stopRecording()
                else -> main.postDelayed(this, POLL_MS)
            }
        }
    }

    private fun stopRecording(discard: Boolean = false) {
        val active = recorder
        if (active == null) {
            finishIfIdle()
            return
        }
        main.removeCallbacks(poll)
        recorder = null
        releaseVolumeKeys()
        RecorderKeys.reset()
        RecorderGuard.stopped()
        val stoppedCleanly = try {
            active.stop()
            true
        } catch (_: RuntimeException) {
            false // stopped before any audio was captured
        } finally {
            active.release()
        }
        val captured = file
        file = null
        RecorderState.update(this, false)

        if (discard) {
            Feedback.discarded(this)
            if (stoppedCleanly && captured != null && captured.length() > 0) DiscardStore.discard(this, captured) else captured?.delete()
            finishIfIdle()
            return
        }
        Feedback.recordingStopped(this)

        if (!stoppedCleanly || captured == null || !heardVoice || captured.length() < 1_500) {
            captured?.delete()
            ResultNotifier.empty(this)
            finishIfIdle()
            return
        }
        upload(captured)
    }

    // ── Upload (stays in the foreground while sending) ─────────────────────

    private fun upload(captured: File) {
        uploadsInFlight++
        WidgetState.uploading(this)
        try {
            NotificationManagerCompat.from(this).notify(Notifications.ID_RECORDING, sendingNotification())
        } catch (_: SecurityException) { /* notifications off */ }

        io.execute {
            when (val outcome = Uploader.upload(this, captured) { WidgetState.processing(this) }) {
                is UploadOutcome.Sent -> {
                    captured.delete()
                    ResultNotifier.deliver(this, outcome.response, fromQueue = false)
                }
                is UploadOutcome.Retry -> {
                    UploadWorker.enqueue(this, captured)
                    ResultNotifier.queued(this, outcome.reason)
                }
                is UploadOutcome.Failed -> {
                    captured.delete()
                    ResultNotifier.failed(this, outcome.reason)
                }
            }
            QuickRecorderPlugin.notifyPending(this)
            main.post {
                uploadsInFlight--
                finishIfIdle()
            }
        }
    }

    private fun finishIfIdle() {
        if (recorder != null || uploadsInFlight > 0 || starting) return
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        main.removeCallbacks(beginAfterCountdown)
        releaseVolumeKeys()
        recorder?.let { active ->
            // Killed mid-recording: keep what we have and queue it
            runCatching { active.stop() }
            active.release()
            recorder = null
            file?.let { if (heardVoice && it.length() > 1_500) UploadWorker.enqueue(this, it) else it.delete() }
            RecorderState.update(this, false)
        }
        io.shutdown()
        super.onDestroy()
    }

    // ── Notifications ──────────────────────────────────────────────────────

    private fun stopIntent(): PendingIntent = PendingIntent.getService(
        this, 0, intent(this, ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun recordingNotification() =
        NotificationCompat.Builder(this, Notifications.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.GOLD)
            .setContentTitle("Recording…")
            .setContentText("Tap to stop")
            .setOngoing(true)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(stopIntent())
            .addAction(R.drawable.ic_stop_white, "Stop", stopIntent())
            .build()

    private fun sendingNotification() =
        NotificationCompat.Builder(this, Notifications.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.GOLD)
            .setContentTitle("Saving voice note…")
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
}
