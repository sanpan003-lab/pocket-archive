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
        const val ACTION_CONFIRM = "com.sanpan003.pocketarchive.recorder.CONFIRM"
        const val EXTRA_SOURCE = "source"
        private const val CONFIRM_MS = 3_000L
        private const val MIN_LENGTH_MS = 2_000L
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
    /** Accidental recordings: speech heard? (voice activity, not just loudness) */
    private var speech = SpeechDetector()
    private var checking = false      // pocket check running
    private var source = "app"         // where the start came from (app | quick-record | widget/tile | shortcut …)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        PocketCheck.watchScreen(this)
        AccidentalStore.cleanup(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> if (recorder == null && !starting && !checking && !RecorderState.confirming) startRecording(intent.getStringExtra(EXTRA_SOURCE) ?: "external")
            ACTION_CONFIRM -> if (RecorderState.confirming) confirmed()
            ACTION_STOP -> if (RecorderState.confirming) endConfirm(false) else if (starting) cancelCountdown() else stopRecording()
            ACTION_DISCARD -> if (RecorderState.confirming) endConfirm(false) else if (starting) cancelCountdown() else stopRecording(discard = true)
            else -> if (recorder == null && uploadsInFlight == 0) stopSelf()
        }
        return START_NOT_STICKY
    }

    // ── Recording ──────────────────────────────────────────────────────────

    private fun startRecording(from: String) {
        source = from
        // Enter the foreground first (Android requires it within seconds of startForegroundService)
        try {
            ServiceCompat.startForeground(
                this, Notifications.ID_RECORDING, if (source == "app") recordingNotification() else startingNotification(),
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

        // Accidental recordings — only for starts from outside the app (keys, widget, routines, tile…)
        val outside = source != "app"
        if (outside && AccidentalStore.inCooldown()) {
            RecorderGuard.note("Ignored a start from $source: within 3 s of an ignored recording")
            finishIfIdle()
            return
        }
        if (outside && prefs.pocketDetection && PocketCheck.screenOffOrJustWoken(this)) {
            checking = true
            PocketCheck.isNear(this) { near ->
                checking = false
                if (near) {
                    Feedback.pocket(this)
                    AccidentalStore.ignore(this, null, "pocket", "In a pocket or bag (proximity sensor)")
                    finishIfIdle()
                } else afterChecks(prefs, outside)
            }
            return
        }
        afterChecks(prefs, outside)
    }

    private fun afterChecks(prefs: RecorderPrefs.Settings, outside: Boolean) {
        if (outside && prefs.confirmStart) { askToConfirm(); return }
        beginOrCountdown(prefs)
    }

    private fun beginOrCountdown(prefs: RecorderPrefs.Settings) {
        if (prefs.countdown) {
            starting = true
            Feedback.countdown(this)
            main.postDelayed(beginAfterCountdown, COUNTDOWN_MS)
        } else {
            beginRecording()
        }
    }

    // ── "Press again to confirm" ───────────────────────────────────────────

    private fun askToConfirm() {
        RecorderState.confirming = true
        RecorderGuard.note("Asking to confirm (3 s)")
        Feedback.confirmPrompt(this)
        showForeground(confirmNotification())
        captureVolumeKeys(confirmOnly = true)
        main.postDelayed(confirmTimeout, CONFIRM_MS)
    }

    private val confirmTimeout = Runnable { endConfirm(false) }

    private fun confirmed() = endConfirm(true)

    private fun endConfirm(start: Boolean) {
        if (!RecorderState.confirming) return
        main.removeCallbacks(confirmTimeout)
        RecorderState.confirming = false
        releaseVolumeKeys()
        if (start) {
            RecorderGuard.note("Confirmed — recording")
            showForeground(recordingNotification())
            beginOrCountdown(RecorderPrefs.get(this))
        } else {
            AccidentalStore.ignore(this, null, "confirm", "Not confirmed within 3 s")
            finishIfIdle()
        }
    }

    /** Swap the foreground notification (a plain notify() update was ignored on Samsung) */
    private fun showForeground(n: android.app.Notification) {
        try {
            ServiceCompat.startForeground(this, Notifications.ID_RECORDING, n,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
        } catch (e: Exception) { Log.w(TAG, "Foreground notification not updated", e) }
    }

    /** Before the pocket check / confirm prompt: not "Recording…" yet */
    private fun startingNotification() =
        NotificationCompat.Builder(this, Notifications.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Voice note…")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    private fun confirmNotification() =
        NotificationCompat.Builder(this, Notifications.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Record a voice note?")
            .setContentText("Press volume up or tap within 3 seconds")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(PendingIntent.getService(this, 3, intent(this, ACTION_CONFIRM), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .addAction(R.drawable.ic_mic_white, "Record", PendingIntent.getService(this, 3, intent(this, ACTION_CONFIRM), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()

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
        speech = SpeechDetector()
        if (source != "app") showForeground(recordingNotification())
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
    private fun captureVolumeKeys(confirmOnly: Boolean = false) {
        releaseVolumeKeys()
        try {
            val provider = object : VolumeProviderCompat(VOLUME_CONTROL_RELATIVE, 100, 50) {
                override fun onAdjustVolume(direction: Int) {
                    when {
                        confirmOnly -> if (direction > 0) main.post { confirmed() }
                        direction < 0 -> main.post { keyFromSession(RecorderKeys.Key.DOWN) }
                        direction > 0 -> main.post { keyFromSession(RecorderKeys.Key.UP) }
                    }
                }
                override fun onSetVolumeTo(volume: Int) {
                    if (confirmOnly) { if (volume > currentVolume) main.post { confirmed() }; return }
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
            speech.feed(amp, now - startedElapsed)
            val prefs = RecorderPrefs.get(this@QuickRecorderService)

            when {
                prefs.noSpeechDiscard && !speech.speech && now - startedElapsed >= prefs.noSpeechSec * 1000L ->
                    stopRecording(autoReason = "No speech in the first ${prefs.noSpeechSec} s")
                now - startedElapsed >= maxMs -> stopRecording()
                now - lastVoiceElapsed >= silenceMs -> stopRecording()
                else -> main.postDelayed(this, POLL_MS)
            }
        }
    }

    private fun stopRecording(discard: Boolean = false, autoReason: String? = null) {
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
        val lengthMs = SystemClock.elapsedRealtime() - startedElapsed
        RecorderState.update(this, false)

        if (discard) {
            Feedback.discarded(this)
            if (stoppedCleanly && captured != null && captured.length() > 0) DiscardStore.discard(this, captured) else captured?.delete()
            finishIfIdle()
            return
        }
        // Accidental recordings: kept 30 s with "Restore" (never silently deleted)
        val prefs = RecorderPrefs.get(this)
        val reason = when {
            !stoppedCleanly || captured == null || captured.length() < 1_500 -> null.also { captured?.delete() }
            autoReason != null -> autoReason
            prefs.minLengthDiscard && lengthMs < MIN_LENGTH_MS -> "Shorter than 2 s"
            !speech.speech -> "No speech heard"
            else -> ""
        }
        if (reason != "") {
            Feedback.discarded(this)
            if (reason != null) AccidentalStore.ignore(this, captured, if (reason.startsWith("Shorter")) "too-short" else "no-speech", reason)
            ResultNotifier.empty(this)
            finishIfIdle()
            return
        }
        Feedback.recordingStopped(this)
        upload(captured!!)
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
        if (recorder != null || uploadsInFlight > 0 || starting || checking || RecorderState.confirming) return
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        main.removeCallbacks(beginAfterCountdown)
        main.removeCallbacks(confirmTimeout)
        RecorderState.confirming = false
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
            .setColor(Notifications.BRAND)
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
            .setColor(Notifications.BRAND)
            .setContentTitle("Saving voice note…")
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
}
