package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Wrist buzzes: short on start, double on stop / saved, one long for "needs review". */
object Haptics {
    val PATTERN_DOUBLE = longArrayOf(0, 60, 80, 60)
    val PATTERN_LONG = longArrayOf(0, 400)

    private fun vibrate(ctx: Context, effect: VibrationEffect) {
        runCatching {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java) // Wear OS 3 / Android 11
            }
            vibrator?.vibrate(effect)
        }
    }

    fun start(ctx: Context) = vibrate(ctx, VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
    fun stop(ctx: Context) = vibrate(ctx, VibrationEffect.createWaveform(PATTERN_DOUBLE, -1))
    fun success(ctx: Context) = vibrate(ctx, VibrationEffect.createWaveform(PATTERN_DOUBLE, -1))
    fun review(ctx: Context) = vibrate(ctx, VibrationEffect.createWaveform(PATTERN_LONG, -1))
}
