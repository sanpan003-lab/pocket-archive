package com.sanpan003.pocketarchive.quick

import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Voice activity detection on the recorder's level readings (MediaRecorder.getMaxAmplitude, one every
 * ~50 ms). "Loud" isn't enough: speech is loud for a while AND goes on and off with syllables, with an
 * uneven level. A tap or knock (one short spike), a steady hum or fan (loud but flat) and a pocket's
 * silence don't count. A pocket rustle can still look like speech — that's what pocket detection and
 * the 30-second Restore are for.
 *
 * The same file is in the watch module (keep them in sync). Unit tested in SpeechDetectorTest with real
 * (synthesized) speech, silence, taps and hum.
 */
class SpeechDetector(private val frameMs: Long = 50) {
    companion object {
        const val GRACE_MS = 700L          // ignore the start beep / button click
        const val MIN_LEVEL = 1_500.0      // getMaxAmplitude() is 0..32767
        const val MIN_VOICED_MS = 400L     // syllables need at least this much sound…
        const val MIN_ONSETS = 2           // …starting at least twice (on/off rhythm)
        const val LONG_VOICED_MS = 1_000L  // or a long uneven stretch in total
        const val WORD_RUN_MS = 250L       // or one word: an unbroken, uneven sound this long (a tap is ~100 ms)
        const val MIN_SPREAD = 0.25        // std. dev. of ln(level) while voiced; a hum is flatter (~0.02)
        const val WORD_SPREAD = 0.15       // a single quiet word is less uneven than a sentence
    }

    var noiseFloor = 400.0
        private set
    var voicedMs = 0L
        private set
    var onsets = 0
        private set
    /** Became true once speech was heard (stays true) */
    var speech = false
        private set

    private var wasVoiced = false
    private var quietFrames = 0
    private var runMs = 0L
    /** Longest unbroken sound so far */
    var longestRunMs = 0L
        private set
    private var n = 0
    private var mean = 0.0
    private var m2 = 0.0

    /** How uneven the level is while voiced (std. dev. of ln(level)) */
    val spread: Double get() = if (n > 1) sqrt(m2 / (n - 1)) else 0.0

    /** One level reading at [elapsedMs] since the start → speech heard so far? */
    fun feed(level: Double, elapsedMs: Long): Boolean {
        val threshold = max(MIN_LEVEL, noiseFloor * 2.5)
        val voiced = elapsedMs > GRACE_MS && level > threshold
        if (voiced) {
            voicedMs += frameMs
            // A new syllable: sound after at least one quiet frame
            if (!wasVoiced && quietFrames >= 1) onsets++
            if (!wasVoiced && onsets == 0) onsets = 1
            quietFrames = 0
            runMs += frameMs
            if (runMs > longestRunMs) longestRunMs = runMs
            val x = ln(level)
            n++
            val d = x - mean
            mean += d / n
            m2 += d * (x - mean)
            // A sound that never stops slowly becomes the background (fan, engine)
            noiseFloor = noiseFloor * 0.995 + level * 0.005
        } else {
            quietFrames++
            runMs = 0
            noiseFloor = noiseFloor * 0.95 + level * 0.05
        }
        wasVoiced = voiced
        if (!speech) {
            speech = (voicedMs >= MIN_VOICED_MS && onsets >= MIN_ONSETS) ||
                (voicedMs >= LONG_VOICED_MS && spread >= MIN_SPREAD) ||
                (longestRunMs >= WORD_RUN_MS && spread >= WORD_SPREAD)
        }
        return speech
    }
}
