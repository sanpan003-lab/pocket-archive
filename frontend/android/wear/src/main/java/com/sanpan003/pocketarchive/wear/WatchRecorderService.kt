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
import android.os.PowerManager
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Records AAC/.m4a in a microphone foreground service (keeps going when the
 * screen dims). Stops on tap, after 4 s of silence, or at 2 minutes — same
 * as the phone — then queues the file for the phone.
 * Audio: PcmRecorder + VoiceDetector (raw sound, ignores steady noise); MediaRecorder if that can't start.
 * Each start is reported to the phone's recording log (/pa/rec-log).
 */
class WatchRecorderService : Service() {

    companion object {
        private const val TAG = "WatchRecorder"
        private const val ACTION_START = "start"
        private const val ACTION_STOP = "stop"
        const val EXTRA_SOURCE = "source"
        private const val POLL_MS = 200L
        private const val COUNTDOWN_MS = 900L
        private const val GRACE_MS = 700L
        private const val MIN_THRESHOLD = 1_500.0

        /** Only from the foreground (activity): Android requires it for microphone services. */
        fun start(ctx: Context, source: String = "app") {
            if (WatchState.isRecording) return
            ContextCompat.startForegroundService(ctx, Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_START).putExtra(EXTRA_SOURCE, source))
        }

        /** "Start a new note": save this one, start the next */
        fun restart(ctx: Context, source: String = "app") {
            stop(ctx)
            ContextCompat.startForegroundService(ctx, Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_START).putExtra(EXTRA_SOURCE, source))
        }

        fun stop(ctx: Context) {
            if (!WatchState.isRecording) return
            ctx.startService(Intent(ctx, WatchRecorderService::class.java).setAction(ACTION_STOP))
        }

        fun toggle(ctx: Context) = if (WatchState.isRecording) stop(ctx) else start(ctx)
    }

    private val main = Handler(Looper.getMainLooper())
    private interface Rec { val amplitude: Int; fun finish(): Boolean }
    private class PcmRec(val r: PcmRecorder) : Rec {
        override val amplitude get() = r.maxAmplitude
        override fun finish() = r.stop()
    }
    private class MediaRec(val r: MediaRecorder) : Rec {
        override val amplitude get() = try { r.maxAmplitude } catch (_: RuntimeException) { 0 }
        override fun finish(): Boolean = try { r.stop(); true } catch (_: RuntimeException) { false } finally { r.release() }
    }
    private var recorder: Rec? = null
    private var voice: VoiceDetector? = null
    private var source = "app"
    private var log = JSONObject()
    private var file: File? = null
    private var startedElapsed = 0L
    private var lastVoiceElapsed = 0L
    private var heardVoice = false
    private var noiseFloor = 400.0
    private var starting = false
    private var silenceMs = 4_000L
    private var maxMs = 120_000L
    private var speech = SpeechDetector()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> if (recorder == null && !starting) { source = intent.getStringExtra(EXTRA_SOURCE) ?: "app"; startRecording() } else Unit
            ACTION_STOP -> if (starting) { main.removeCallbacks(begin); starting = false; finish() } else stopRecording()
            else -> if (recorder == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRecording() {
        log = JSONObject().put("id", java.util.UUID.randomUUID().toString().take(8)).put("at", System.currentTimeMillis())
            .put("source", source).put("screen", if (getSystemService(PowerManager::class.java)?.isInteractive == false) "off" else "on")
        WatchNotifications.ensureChannels(this)
        IgnoredRecordings.cleanup(this)
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
        val detector = VoiceDetector(PcmRecorder.SAMPLE_RATE)
        val pcm = PcmRecorder(output) { buf, n -> detector.feed(buf, n) }
        val pcmOk = try { pcm.start(); true } catch (e: Exception) { Log.w(TAG, "PCM recording unavailable, using MediaRecorder", e); output.delete(); false }
        if (pcmOk) { voice = detector; onStarted(PcmRec(pcm), output); return }
        voice = null
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
            sendLog("result" to "failed", "reason" to "Microphone busy")
            finish()
            return
        }
        onStarted(MediaRec(mr), output)
    }

    private fun onStarted(rec: Rec, output: File) {
        recorder = rec
        file = output
        startedElapsed = SystemClock.elapsedRealtime()
        lastVoiceElapsed = startedElapsed
        heardVoice = false
        noiseFloor = 400.0
        speech = SpeechDetector()
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
            val amp = active.amplitude.toDouble()
            val threshold = max(MIN_THRESHOLD, noiseFloor * 2.5)
            if (amp > threshold) {
                if (now - startedElapsed > GRACE_MS) { lastVoiceElapsed = now; heardVoice = true }
            } else {
                noiseFloor = noiseFloor * 0.95 + amp * 0.05
            }
            WatchState.level(min(1.0, amp / 12_000.0).toFloat())
            speech.feed(amp, now - startedElapsed)
            val prefs = WatchPrefs.get(this@WatchRecorderService)
            when {
                prefs.noSpeechDiscard && !heardSpeech() && now - startedElapsed >= prefs.noSpeechSec * 1000L ->
                    stopRecording("No speech in the first ${prefs.noSpeechSec} s")
                now - startedElapsed >= maxMs -> stopRecording()
                now - lastVoiceElapsed >= silenceMs -> stopRecording()
                else -> main.postDelayed(this, POLL_MS)
            }
        }
    }

    private fun heardSpeech() = voice?.speech ?: speech.speech

    /** The phone's recording log (Settings → Accidental recordings) */
    private fun sendLog(vararg fields: Pair<String, Any?>) {
        fields.forEach { (k, v) -> log.put(k, v ?: JSONObject.NULL) }
        val bytes = log.toString().toByteArray()
        val app = applicationContext
        Wearable.getNodeClient(app).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { Wearable.getMessageClient(app).sendMessage(it.id, Protocol.MSG_REC_LOG, bytes) }
        }
    }

    private fun stopRecording(autoReason: String? = null) {
        val active = recorder ?: return finish()
        main.removeCallbacks(poll)
        recorder = null
        WatchPrefs.stopped()
        val clean = active.finish()
        voice?.finish()
        val captured = file
        file = null
        val lengthMs = SystemClock.elapsedRealtime() - startedElapsed
        Haptics.stop(this)
        WatchState.level(0f)

        // Accidental recordings: kept 30 s with Restore (never silently deleted)
        val prefs = WatchPrefs.get(this)
        val reason = when {
            !clean || captured == null || captured.length() < 1_500 -> null
            autoReason != null -> autoReason
            prefs.minLengthDiscard && lengthMs < 2_000 -> "Shorter than 2 s"
            !heardSpeech() -> "No speech heard"
            else -> ""
        }
        sendLog(
            "result" to if (reason == "") "recorded" else "ignored", "reason" to (reason ?: "Nothing was captured").ifEmpty { null },
            "lengthSec" to lengthMs / 1000.0, "syllables" to (voice?.syllables ?: -1),
            "speech" to (voice?.summary() ?: if (speech.speech) "Sounded like speech (volume only)" else "No speech (volume only)"),
            "clientId" to captured?.name?.substringAfter('_')?.removeSuffix(".m4a"),
        )
        if (reason != "") {
            if (reason == null) captured?.delete() else IgnoredRecordings.keep(this, captured!!, reason)
            WatchState.set(Phase.Result("🎙️", if (reason == null) "Didn't hear anything" else "Ignored — tap the notification to restore", "review", reason ?: "Nothing was saved"))
        } else {
            CaptureQueue.enqueue(this, captured!!)
            WatchState.set(Phase.Sending)
            SendWorker.sendNow(this)
        }
        RecordTileService.requestUpdate(this)
        WatchUpdater.installPending(this) // an update waited for the recording to end
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
            runCatching { active.finish() }
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
