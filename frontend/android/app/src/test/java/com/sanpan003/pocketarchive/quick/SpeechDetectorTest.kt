package com.sanpan003.pocketarchive.quick

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.random.Random

/**
 * The accidental-recording rule must never throw away real speech, and must ignore silence, taps and hums.
 * Speech: real synthesized phrases (Windows voices "David" and "Zira", 16 kHz WAV in test resources),
 * turned into the same 50 ms peak levels MediaRecorder.getMaxAmplitude() gives, at normal and quiet volume,
 * after a second of room noise (pocket / start beep).
 */
class SpeechDetectorTest {
    private val rnd = Random(42)

    /** WAV (16-bit mono PCM) → peak level per 50 ms, scaled by [gain] */
    private fun levels(wav: File, gain: Double): List<Double> {
        val bytes = wav.readBytes()
        var off = 12
        var dataStart = -1; var dataLen = 0; var rate = 16000
        while (off + 8 <= bytes.size) {
            val id = String(bytes, off, 4)
            val len = ByteBuffer.wrap(bytes, off + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
            if (id == "fmt ") rate = ByteBuffer.wrap(bytes, off + 12, 4).order(ByteOrder.LITTLE_ENDIAN).int
            if (id == "data") { dataStart = off + 8; dataLen = len; break }
            off += 8 + len
        }
        val samples = ByteBuffer.wrap(bytes, dataStart, minOf(dataLen, bytes.size - dataStart)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val win = rate / 20
        val out = ArrayList<Double>()
        var peak = 0.0; var i = 0
        while (samples.hasRemaining()) {
            peak = maxOf(peak, abs(samples.get().toDouble()) * gain)
            if (++i % win == 0) { out += peak; peak = 0.0 }
        }
        return out
    }

    private fun room(ms: Int) = List(ms / 50) { 200.0 + rnd.nextDouble() * 400 }

    private fun detect(trace: List<Double>): SpeechDetector {
        val d = SpeechDetector()
        trace.forEachIndexed { k, level -> d.feed(level, k * 50L) }
        return d
    }

    private val clips: List<File> by lazy {
        val dir = File(javaClass.classLoader!!.getResource("vad")!!.toURI())
        dir.listFiles { f -> f.name.endsWith(".wav") }!!.sortedBy { it.name }
    }

    @Test fun realSpeechIsAlwaysSpeech() {
        assertTrue("speech clips present", clips.size >= 8)
        for (clip in clips) for (gain in listOf(1.0, 0.35)) {
            val trace = room(1000) + levels(clip, gain) + room(500)
            val d = detect(trace)
            assertTrue("${clip.name} at gain $gain (voiced ${d.voicedMs} ms, onsets ${d.onsets}, run ${d.longestRunMs} ms, spread ${"%.2f".format(d.spread)})", d.speech)
        }
    }

    @Test fun speechIsHeardWithinFourSeconds() {
        // "No speech in the first 4 s" must not fire when someone starts talking after ~1.5 s
        for (clip in clips) {
            val trace = room(1500) + levels(clip, 0.35)
            val d = SpeechDetector()
            var heardAt = -1L
            trace.forEachIndexed { k, level -> if (d.feed(level, k * 50L) && heardAt < 0) heardAt = k * 50L }
            assertTrue("${clip.name}: heard at $heardAt ms", heardAt in 0..4000)
        }
    }

    @Test fun silenceIsNotSpeech() = assertFalse(detect(room(8000)).speech)

    @Test fun aTapIsNotSpeech() {
        val tap = room(1500) + listOf(18000.0, 9000.0) + room(3000)
        assertFalse(detect(tap).speech)
    }

    @Test fun twoTapsAreNotSpeech() {
        val taps = room(1500) + listOf(18000.0, 6000.0) + room(400) + listOf(16000.0, 5000.0) + room(3000)
        assertFalse(detect(taps).speech)
    }

    @Test fun aSteadyHumIsNotSpeech() {
        val hum = room(1000) + List(160) { 3000.0 * (1 + (rnd.nextDouble() - 0.5) * 0.06) }
        assertFalse(detect(hum).speech)
    }

    @Test fun aHumFromTheStartIsNotSpeech() {
        val hum = List(200) { 2500.0 * (1 + (rnd.nextDouble() - 0.5) * 0.06) }
        assertFalse(detect(hum).speech)
    }
}
