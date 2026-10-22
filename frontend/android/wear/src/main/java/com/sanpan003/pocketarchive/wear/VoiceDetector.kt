package com.sanpan003.pocketarchive.wear

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Voice detection on the raw microphone audio (not just its volume). Speech is made of syllables:
 * short stretches of VOICED sound (a pitch between 70 and 400 Hz) whose pitch moves, separated by dips
 * in loudness. Steady background noise doesn't look like that:
 * - road / wind / rain: no pitch at all (broadband noise)
 * - a fan, fridge or engine hum: a pitch, but one that never moves and never stops
 * - music: notes hold a steady pitch, and the sound keeps going (no syllable dips)
 * A tap or knock is far too short. Speech from a TV or radio still counts — that's what pocket
 * detection, "Press again to confirm" and the 30-second Restore are for.
 *
 * Speech = two syllables, or one clear word (≥ 120 ms, pitch moving ≥ 4 %, a deep dip around it).
 * Thread-safe for one writer (the recorder thread) and readers on other threads.
 * Same file in the watch module (keep them in sync). Tested in VoiceDetectorTest (real speech clips,
 * with road noise and music under them; road, fan, music, taps and silence alone).
 */
class VoiceDetector(sampleRate: Int) {
    companion object {
        const val GRACE_MS = 700L           // ignore the start beep / button click
        const val MIN_RMS = 30.0            // 16-bit samples
        const val VOICED_P = 0.5            // normalized autocorrelation at the pitch period
        const val ABOVE_FLOOR_DB = 6.0      // louder than the background by this much
        const val F0_MIN = 70.0
        const val F0_MAX = 400.0
        const val SEG_MIN_FRAMES = 2
        const val SEG_MAX_MS = 1_500.0      // longer = a drone / hum / held note
        const val PITCH_RANGE = 0.015       // a syllable's pitch moves at least this much
        const val DIP_MIN_DB = 4.0
        const val NEED = 2
    }

    private val d = max(1, sampleRate / 8000)
    private val fs = sampleRate.toDouble() / d
    private val n = Math.round(fs * 0.032).toInt()      // one hop ≈ 32 ms
    private val hopMs = 1000.0 * n / fs
    private val win = DoubleArray(2 * n)                // last two hops, pre-emphasized
    private val hop = DoubleArray(n)
    private val hopRaw = DoubleArray(n)
    private var k = 0
    private var acc = 0.0
    private var accN = 0
    private var prev = 0.0
    private val tMin = (fs / F0_MAX).toInt()
    private val tMax = Math.ceil(fs / F0_MIN).toInt()
    private val rs = DoubleArray(tMax + 2)
    private var floor = Double.NaN
    private var frames = 0
    private val hist = ArrayDeque<Double>()
    private var seg: Seg? = null
    private var gap = 0

    private class Seg(val startMs: Double, val before: Double, val floor: Double) {
        val f0 = ArrayList<Double>()
        val e = ArrayList<Double>()
        var after = Double.MAX_VALUE
    }

    /** Speech heard (stays true) */
    @Volatile var speech = false
        private set
    @Volatile var syllables = 0
        private set
    @Volatile var strongWords = 0
        private set
    @Volatile var voicedMs = 0L
        private set
    /** Pitched sound that wasn't speech-like (a hum, a held note, a ringtone) */
    @Volatile var rejected = 0
        private set
    @Volatile var speechAtMs = -1L
        private set

    /** 16-bit PCM, mono */
    fun feed(pcm: ShortArray, count: Int = pcm.size) {
        for (i in 0 until count) {
            acc += pcm[i]
            if (++accN < d) continue
            val x = acc / d
            acc = 0.0; accN = 0
            hop[k] = x - 0.9 * prev
            hopRaw[k] = x
            prev = x
            if (++k == n) { k = 0; frame() }
        }
    }

    /** The end of the recording: count a syllable still in progress */
    fun finish() { if (seg != null) endSeg() }

    private fun frame() {
        System.arraycopy(win, n, win, 0, n)
        System.arraycopy(hop, 0, win, n, n)
        var mean = 0.0
        for (v in hopRaw) mean += v
        mean /= n
        var ss = 0.0
        for (v in hopRaw) ss += (v - mean) * (v - mean)
        val rms = sqrt(ss / n)
        val e = 20 * log10(rms + 1)
        val tMs = frames * hopMs
        frames++
        floor = when {
            floor.isNaN() -> e
            e < floor -> 0.5 * floor + 0.5 * e
            else -> floor + 0.05
        }
        // Pitch: the strongest normalized autocorrelation between 2.5 and 14 ms (+ parabolic refinement)
        var best = 0.0
        var bestT = 0
        if (frames >= 2 && rms >= MIN_RMS) {
            val len = win.size
            for (t in tMin - 1..tMax + 1) {
                var xy = 0.0; var xx = 0.0; var yy = 0.0
                var i = 0
                while (i + t < len) { val a = win[i]; val b = win[i + t]; xy += a * b; xx += a * a; yy += b * b; i++ }
                val r = xy / sqrt(xx * yy + 1e-9)
                rs[t] = r
                if (t in tMin..tMax && r > best) { best = r; bestT = t }
            }
        }
        var f0 = 0.0
        if (bestT > 0) {
            val a = rs[bestT - 1]; val b = rs[bestT]; val c = rs[bestT + 1]
            val den = a - 2 * b + c
            f0 = fs / (bestT + if (den < 0) 0.5 * (a - c) / den else 0.0)
        }
        val voiced = tMs > GRACE_MS && rms >= MIN_RMS && best >= VOICED_P && e >= floor + ABOVE_FLOOR_DB && f0 in F0_MIN..F0_MAX
        hist.addLast(e)
        if (hist.size > 40) hist.removeFirst()
        if (voiced) {
            voicedMs += hopMs.toLong()
            val s = seg ?: Seg(tMs, minOf(hist.toList().takeLast(12).minOrNull() ?: e, e), floor).also { seg = it }
            s.f0 += f0
            s.e += e
            gap = 0
        } else seg?.let { s ->
            gap++
            s.after = min(s.after, e)
            if (gap >= 2) endSeg()
        }
    }

    private fun endSeg() {
        val s = seg ?: return
        seg = null
        gap = 0
        val count = s.f0.size
        val dur = count * hopMs
        val med = s.f0.sorted()[count / 2]
        val near = s.f0.filter { abs(it - med) / med < 0.15 }
        val range = if (near.isNotEmpty()) (near.max() - near.min()) / med else 0.0
        val pk = s.e.max()
        val dip = pk - min(s.before, if (s.after == Double.MAX_VALUE) pk else s.after)
        val need = max(DIP_MIN_DB, min(10.0, (pk - s.floor) * 0.5))
        val ok = count >= SEG_MIN_FRAMES && dur <= SEG_MAX_MS && range >= PITCH_RANGE && dip >= need
        val strong = ok && dur >= 120 && range >= 0.04 && dip >= 10
        if (ok) syllables++ else if (count >= SEG_MIN_FRAMES) rejected++
        if (strong) strongWords++
        if (!speech && (syllables >= NEED || strongWords >= 1)) {
            speechAtMs = (s.startMs + dur).toLong()
            speech = true
        }
    }

    /** For the recording log: what was heard */
    fun summary(): String = when {
        speech -> "Voice: $syllables syllable${if (syllables == 1) "" else "s"}"
        rejected > 0 -> "No voice — steady pitch or noise ($rejected sound${if (rejected == 1) "" else "s"} ignored)"
        voicedMs > 0 -> "No voice — only short sounds"
        else -> "No voice"
    }
}
