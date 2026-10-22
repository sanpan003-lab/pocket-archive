package com.sanpan003.pocketarchive.quick

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Voice detection on raw audio: real (synthesized) speech must always count — alone, quiet, over road noise
 * and over music — and steady background sounds must not: road noise, a fan with motor hum, music (legato,
 * staccato, with vibrato and glides), taps, silence. Speech: Windows voices "David" and "Zira", 16 kHz WAV.
 */
class VoiceDetectorTest {
    private val rate = 16_000
    private val rnd = Random(42)
    private fun gauss(): Double {
        var u = 0.0
        while (u == 0.0) u = rnd.nextDouble()
        return sqrt(-2 * ln(u)) * cos(2 * PI * rnd.nextDouble())
    }

    private fun wav(file: File): DoubleArray {
        val bytes = file.readBytes()
        var off = 12
        var start = -1; var len = 0
        while (off + 8 <= bytes.size) {
            val id = String(bytes, off, 4)
            val l = ByteBuffer.wrap(bytes, off + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
            if (id == "data") { start = off + 8; len = l; break }
            off += 8 + l
        }
        val sb = ByteBuffer.wrap(bytes, start, minOf(len, bytes.size - start)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        return DoubleArray(sb.remaining()) { sb.get().toDouble() }
    }

    private fun samples(ms: Int) = rate * ms / 1000
    private fun room(ms: Int) = DoubleArray(samples(ms)) { gauss() * 60 }
    private fun scaleRms(o: DoubleArray, rms: Double): DoubleArray {
        val k = rms / sqrt(o.sumOf { it * it } / o.size)
        return DoubleArray(o.size) { o[it] * k }
    }
    private fun rmsOf(o: DoubleArray) = sqrt(o.sumOf { it * it } / o.size)
    private fun cat(vararg parts: DoubleArray) = parts.reduce { a, b -> a + b }
    private fun mix(a: DoubleArray, b: DoubleArray) = DoubleArray(a.size) { a[it] + (if (it < b.size) b[it] else 0.0) }
    private fun gain(a: DoubleArray, g: Double) = DoubleArray(a.size) { a[it] * g }

    private fun road(ms: Int, rms: Double): DoubleArray {
        val o = DoubleArray(samples(ms)); var b = 0.0; var p = 0.0
        for (i in o.indices) {
            b = 0.995 * b + gauss(); p = 0.9 * p + gauss()
            o[i] = (b * 0.5 + p * 0.6 + gauss() * 0.3) * (1 + 0.3 * sin(2 * PI * 0.3 * i / rate))
            if (rnd.nextDouble() < 0.00002) for (k in 0 until 800) if (i + k < o.size) o[i + k] += gauss() * 8 * exp(-k / 200.0)
        }
        return scaleRms(o, rms)
    }
    private fun fan(ms: Int, rms: Double): DoubleArray {
        val o = DoubleArray(samples(ms)); var lp = 0.0
        for (i in o.indices) {
            val t = i.toDouble() / rate; lp = 0.7 * lp + gauss()
            val mod = 1 + 0.25 * sin(2 * PI * 6 * t)
            o[i] = lp * 0.8 * mod + 1.5 * sin(2 * PI * 120 * t) + 0.8 * sin(2 * PI * 240 * t) + 0.6 * sin(2 * PI * 46 * t + 0.3) * mod
        }
        return scaleRms(o, rms)
    }
    private fun music(ms: Int, rms: Double, staccato: Boolean = false): DoubleArray {
        val scale = doubleArrayOf(220.0, 247.0, 262.0, 294.0, 330.0, 349.0, 392.0, 440.0, 494.0, 523.0)
        val chord = doubleArrayOf(130.8, 164.8, 196.0)
        val noteLen = (0.3 * rate).toInt()
        val o = DoubleArray(samples(ms)); var f = 262.0
        for (i in o.indices) {
            val t = i.toDouble() / rate
            if (i % noteLen == 0) f = scale[rnd.nextInt(scale.size)]
            val tn = (i % noteLen).toDouble() / rate
            val env = if (staccato) exp(-tn * 9) else minOf(1.0, tn * 40) * (0.8 + 0.2 * exp(-tn * 4))
            var v = 0.0
            for (h in 1..6) v += sin(2 * PI * f * h * t) / h
            v *= env
            if (!staccato) for (c in chord) for (h in 1..3) v += 0.25 * sin(2 * PI * c * h * t) / h
            if (!staccato && i % (rate / 2) < 1200) v += gauss() * 0.6 * exp(-(i % (rate / 2)) / 300.0)
            o[i] = v
        }
        return scaleRms(o, rms)
    }
    private fun vibratoMusic(ms: Int, rms: Double): DoubleArray {
        val scale = doubleArrayOf(196.0, 220.0, 247.0, 262.0, 294.0, 330.0, 349.0, 392.0)
        val chord = doubleArrayOf(98.0, 123.5, 147.0)
        val o = DoubleArray(samples(ms)); var f = 262.0; var target = 262.0; var ph = 0.0
        for (i in o.indices) {
            val t = i.toDouble() / rate
            if (i % (0.45 * rate).toInt() == 0) target = scale[rnd.nextInt(scale.size)]
            f += (target - f) * 0.0008
            ph += 2 * PI * f * (1 + 0.02 * sin(2 * PI * 5.5 * t)) / rate
            var v = 0.0
            for (h in 1..6) v += sin(h * ph) / h
            for (c in chord) for (h in 1..3) v += 0.3 * sin(2 * PI * c * h * t) / h
            o[i] = v
        }
        return scaleRms(o, rms)
    }

    /** Feed in 46 ms chunks like the recorder (clipped to 16 bits) */
    private fun detect(sig: DoubleArray, onChunk: ((VoiceDetector, Long) -> Unit)? = null): VoiceDetector {
        val d = VoiceDetector(rate)
        val chunk = 736
        var i = 0
        while (i < sig.size) {
            val cnt = minOf(chunk, sig.size - i)
            val pcm = ShortArray(cnt) { sig[i + it].coerceIn(-32768.0, 32767.0).toInt().toShort() }
            d.feed(pcm, cnt)
            i += cnt
            onChunk?.invoke(d, i * 1000L / rate)
        }
        d.finish()
        return d
    }

    private val clips: List<File> by lazy {
        val dir = File(javaClass.classLoader!!.getResource("vad")!!.toURI())
        dir.listFiles { f -> f.name.endsWith(".wav") }!!.sortedBy { it.name }
    }
    private fun info(d: VoiceDetector) = "syllables ${d.syllables}, words ${d.strongWords}, rejected ${d.rejected}, voiced ${d.voicedMs} ms"

    @Test fun realSpeechIsSpeech() {
        assertTrue("speech clips present", clips.size >= 8)
        for (clip in clips) for (g in listOf(1.0, 0.35)) {
            val d = detect(cat(room(1000), gain(wav(clip), g), room(500)))
            assertTrue("${clip.name} at gain $g (${info(d)})", d.speech)
        }
    }

    @Test fun speechOverRoadNoiseIsSpeech() {
        for (clip in clips) for (snr in listOf(3.16, 2.0)) {
            val sp = gain(wav(clip), 0.6)
            val sig = cat(room(1000), sp, room(500))
            val d = detect(mix(sig, road(sig.size * 1000 / rate + 100, rmsOf(sp) / snr)))
            assertTrue("${clip.name} over road noise, ${"%.0f".format(20 * Math.log10(snr))} dB (${info(d)})", d.speech)
        }
    }

    @Test fun speechOverMusicIsSpeech() {
        for (clip in clips) {
            val sp = gain(wav(clip), 0.6)
            val sig = cat(room(1000), sp, room(500))
            val d = detect(mix(sig, music(sig.size * 1000 / rate + 100, rmsOf(sp) / 3.16)))
            assertTrue("${clip.name} over music (${info(d)})", d.speech)
        }
    }

    @Test fun speechIsHeardWithinFourSeconds() {
        // "No speech in the first 4 s" must not fire when someone starts talking after ~1.5 s
        for (clip in clips) {
            var heardAt = -1L
            detect(cat(room(1500), gain(wav(clip), 0.35))) { d, ms -> if (d.speech && heardAt < 0) heardAt = ms }
            assertTrue("${clip.name}: heard at $heardAt ms", heardAt in 0..4000)
        }
    }

    @Test fun silenceIsNotSpeech() = assertFalse(detect(room(8000)).speech)

    @Test fun roadNoiseIsNotSpeech() {
        for (lvl in listOf(600.0, 1500.0, 5000.0)) { val d = detect(road(12_000, lvl)); assertFalse("road $lvl (${info(d)})", d.speech) }
    }

    @Test fun aFanIsNotSpeech() {
        for (lvl in listOf(600.0, 1500.0, 5000.0)) { val d = detect(fan(12_000, lvl)); assertFalse("fan $lvl (${info(d)})", d.speech) }
    }

    @Test fun musicIsNotSpeech() {
        for (lvl in listOf(600.0, 1500.0, 5000.0)) {
            for ((name, sig) in listOf("legato" to music(12_000, lvl), "staccato" to music(12_000, lvl, staccato = true), "vibrato" to vibratoMusic(12_000, lvl))) {
                val d = detect(sig)
                assertFalse("music $name $lvl (${info(d)})", d.speech)
            }
        }
    }

    @Test fun aTapIsNotSpeech() {
        val tap = cat(room(1500), DoubleArray(1600) { gauss() * 9000 * exp(-it / 150.0) }, room(3000))
        assertFalse(detect(tap).speech)
    }
}
