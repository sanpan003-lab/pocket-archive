package com.sanpan003.pocketarchive.wear

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max

/**
 * Records the microphone as raw audio (AudioRecord) and encodes it to AAC/.m4a itself (MediaCodec +
 * MediaMuxer): same file as MediaRecorder made (44.1 kHz mono, 64 kbit/s), but the raw samples also go
 * to [onPcm] — the voice detector needs the actual sound, not just its volume.
 * [maxAmplitude] works like MediaRecorder.getMaxAmplitude (peak since the last call, 0..32767).
 * Same file in the watch module (keep them in sync).
 */
class PcmRecorder(private val out: File, private val onPcm: (ShortArray, Int) -> Unit) {
    companion object {
        private const val TAG = "PcmRecorder"
        const val SAMPLE_RATE = 44_100
        private const val BIT_RATE = 64_000
        private const val TIMEOUT_US = 10_000L
    }

    private var record: AudioRecord? = null
    private var codec: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var track = -1
    private var muxing = false
    private var wrote = false
    private var samplesIn = 0L
    @Volatile private var running = false
    @Volatile private var peak = 0
    private var thread: Thread? = null

    /** Throws when the microphone or the encoder can't start (the caller falls back to MediaRecorder) */
    @SuppressLint("MissingPermission") // checked before any recording starts (QuickActions.blocker)
    fun start() {
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuf <= 0) throw IllegalStateException("No PCM buffer size")
        val ar = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, 8192) * 2)
        if (ar.state != AudioRecord.STATE_INITIALIZED) { ar.release(); throw IllegalStateException("AudioRecord not initialized") }
        val c: MediaCodec
        try {
            val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
            }
            c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            c.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            c.start()
        } catch (e: Exception) { ar.release(); throw e }
        val m = try { MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4) } catch (e: Exception) { c.release(); ar.release(); throw e }
        try { ar.startRecording() } catch (e: Exception) { c.release(); m.release(); ar.release(); throw e }
        if (ar.recordingState != AudioRecord.RECORDSTATE_RECORDING) { c.release(); m.release(); ar.release(); throw IllegalStateException("Microphone busy") }
        record = ar; codec = c; muxer = m
        running = true
        thread = Thread({ loop() }, "PcmRecorder").apply { start() }
    }

    /** Peak level since the last call (like MediaRecorder.getMaxAmplitude) */
    val maxAmplitude: Int get() { val p = peak; peak = 0; return p }

    private fun loop() {
        val ar = record ?: return
        val buf = ShortArray(2048) // ~46 ms
        val info = MediaCodec.BufferInfo()
        try {
            while (running) {
                val n = ar.read(buf, 0, buf.size)
                if (n < 0) { Log.w(TAG, "read error $n"); break }
                if (n == 0) continue
                var p = peak
                for (i in 0 until n) { val a = abs(buf[i].toInt()); if (a > p) p = a }
                peak = minOf(p, 32_767)
                runCatching { onPcm(buf, n) }
                encode(buf, n, info)
            }
            endOfStream(info)
        } catch (e: Exception) {
            Log.w(TAG, "Recording loop stopped", e)
        }
    }

    private fun encode(pcm: ShortArray, n: Int, info: MediaCodec.BufferInfo) {
        val c = codec ?: return
        var off = 0
        while (off < n) {
            val idx = c.dequeueInputBuffer(TIMEOUT_US)
            if (idx < 0) { drain(info, false); continue }
            val input = c.getInputBuffer(idx) ?: continue
            input.clear()
            val count = minOf(n - off, input.remaining() / 2)
            val bb = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
            bb.asShortBuffer().put(pcm, off, count)
            input.put(bb)
            c.queueInputBuffer(idx, 0, count * 2, samplesIn * 1_000_000L / SAMPLE_RATE, 0)
            samplesIn += count
            off += count
            drain(info, false)
        }
    }

    private fun endOfStream(info: MediaCodec.BufferInfo) {
        val c = codec ?: return
        for (tries in 0 until 50) {
            val idx = c.dequeueInputBuffer(TIMEOUT_US)
            if (idx >= 0) { c.queueInputBuffer(idx, 0, 0, samplesIn * 1_000_000L / SAMPLE_RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM); break }
            drain(info, false)
        }
        drain(info, true)
    }

    private fun drain(info: MediaCodec.BufferInfo, eos: Boolean) {
        val c = codec ?: return
        val m = muxer ?: return
        var idle = 0
        while (true) {
            val idx = c.dequeueOutputBuffer(info, if (eos) TIMEOUT_US else 0)
            when {
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> { if (!eos || ++idle > 100) return }
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    if (!muxing) { track = m.addTrack(c.outputFormat); m.start(); muxing = true }
                }
                idx >= 0 -> {
                    val data = c.getOutputBuffer(idx)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (info.size > 0 && muxing && data != null) {
                        data.position(info.offset)
                        data.limit(info.offset + info.size)
                        m.writeSampleData(track, data, info)
                        wrote = true
                    }
                    c.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    /** Stop and finish the file. false = nothing usable was written */
    fun stop(): Boolean {
        running = false
        thread?.join(3_000)
        thread = null
        runCatching { record?.stop() }
        runCatching { record?.release() }
        record = null
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        codec = null
        val ok = muxing && wrote
        runCatching { if (muxing) muxer?.stop() }
        runCatching { muxer?.release() }
        muxer = null
        return ok
    }
}
