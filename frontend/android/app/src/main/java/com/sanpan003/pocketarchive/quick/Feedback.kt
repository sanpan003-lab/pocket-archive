package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Start/stop cues (beep + buzz) — respects the app's "Sound & vibration" setting. */
object Feedback {
    private val main = Handler(Looper.getMainLooper())

    // Start/stop cues follow Settings → Recording & shortcuts → "Start/stop feedback"
    private fun buzz(ctx: Context) = RecorderPrefs.get(ctx).feedback.let { it == "both" || it == "vibrate" }
    private fun chime(ctx: Context) = RecorderPrefs.get(ctx).feedback.let { it == "both" || it == "chime" }

    fun recordingStarted(ctx: Context) {
        if (buzz(ctx)) vibrate(ctx, longArrayOf(0, 150))
        if (chime(ctx)) tone(ToneGenerator.TONE_PROP_BEEP, 120)
    }

    fun recordingStopped(ctx: Context) {
        if (buzz(ctx)) vibrate(ctx, longArrayOf(0, 60)) // short buzz: you can feel it stopped (screen off, volume key)
        if (chime(ctx)) tone(ToneGenerator.TONE_PROP_ACK, 150)
    }

    fun discarded(ctx: Context) {
        if (buzz(ctx)) vibrate(ctx, longArrayOf(0, 40, 60, 40, 60, 40))
        if (chime(ctx)) tone(ToneGenerator.TONE_PROP_NACK, 200)
    }

    /** "Short countdown beep before recording starts": three beeps over ~0.9 s */
    fun countdown(ctx: Context) {
        for (i in 0..2) main.postDelayed({ tone(if (i == 2) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP, 90) }, i * 300L)
    }

    fun success(ctx: Context) {
        if (TokenStore.feedbackEnabled(ctx)) vibrate(ctx, Notifications.PATTERN_OK)
    }

    fun warning(ctx: Context) {
        if (TokenStore.feedbackEnabled(ctx)) vibrate(ctx, Notifications.PATTERN_REVIEW)
    }

    private fun vibrate(ctx: Context, pattern: LongArray) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Vibrator::class.java)
        }
        if (vibrator?.hasVibrator() == true) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    private fun tone(type: Int, durationMs: Int) {
        try {
            val generator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60)
            generator.startTone(type, durationMs)
            main.postDelayed({ generator.release() }, durationMs + 200L)
        } catch (_: RuntimeException) {
            // tone generator unavailable — cue is optional
        }
    }
}
