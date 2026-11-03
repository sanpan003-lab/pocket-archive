package com.sanpan003.pocketarchive.quick

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Locale

/**
 * On-device speech to text for the quick-command fast path: no server, works offline.
 * The saved recording (phone .m4a, or the one the watch sent) is decoded to PCM and streamed into Android's
 * SpeechRecognizer through EXTRA_AUDIO_SOURCE (Android 13+). That way the microphone is read by one party only
 * (our recorder) and the same code serves phone and watch recordings.
 */
object LocalSpeech {
    private const val TAG = "LocalSpeech"
    const val MAX_SECONDS = 20

    class Pcm(val bytes: ByteArray, val sampleRate: Int, val seconds: Double)

    /** Is an on-device recognizer usable here? (Settings shows this; false → the server handles everything as before.) */
    fun available(ctx: Context): Boolean = Build.VERSION.SDK_INT >= 33 &&
        (SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx) || SpeechRecognizer.isRecognitionAvailable(ctx))

    /** AAC/m4a → 16-bit mono PCM; null when it can't be read or is longer than [MAX_SECONDS] (not a quick command). */
    fun decode(file: File): Pcm? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(file.absolutePath)
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            if (durationUs > MAX_SECONDS * 1_000_000L) return null
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(format, null, null, 0)
            codec.start()
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val out = ByteArrayOutputStream()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            val deadline = System.currentTimeMillis() + 5_000
            while (!outputDone && System.currentTimeMillis() < deadline) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(5_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        val n = extractor.readSampleData(buf, 0)
                        if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 5_000)
                when {
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = codec.outputFormat
                        rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                    o >= 0 -> {
                        val buf = codec.getOutputBuffer(o)!!
                        val chunk = ByteArray(info.size)
                        buf.position(info.offset); buf.get(chunk)
                        out.write(if (channels > 1) downmix(chunk, channels) else chunk)
                        codec.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
            val bytes = out.toByteArray()
            if (bytes.isEmpty()) return null
            val seconds = bytes.size / 2.0 / rate
            return if (seconds > MAX_SECONDS) null else Pcm(bytes, rate, seconds)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't decode ${file.name}", e)
            return null
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }; runCatching { extractor.release() }
        }
    }

    private fun downmix(pcm: ByteArray, channels: Int): ByteArray {
        val frames = pcm.size / 2 / channels
        val out = ByteArray(frames * 2)
        for (f in 0 until frames) {
            var sum = 0
            for (c in 0 until channels) {
                val i = (f * channels + c) * 2
                sum += ((pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xFF)).toShort().toInt()
            }
            val v = (sum / channels).toShort().toInt()
            out[f * 2] = (v and 0xFF).toByte(); out[f * 2 + 1] = ((v shr 8) and 0xFF).toByte()
        }
        return out
    }

    /**
     * Recognize [pcm]; [done] gets the best transcript, or null (no recognizer, error, timeout). Any thread.
     * The recognizer must live on the main thread, so everything touching it is posted there.
     */
    @SuppressLint("NewApi") // available() has already required Android 13+
    fun recognize(ctx: Context, pcm: Pcm, timeoutMs: Long = 8_000, done: (String?) -> Unit) {
        val app = ctx.applicationContext
        if (!available(app)) { done(null); return }
        val main = Handler(Looper.getMainLooper())
        main.post {
            var finished = false
            var recognizer: SpeechRecognizer? = null
            var pipe: Array<ParcelFileDescriptor>? = null
            fun finish(text: String?) {
                if (finished) return
                finished = true
                runCatching { recognizer?.destroy() }
                runCatching { pipe?.forEach { it.close() } }
                done(text)
            }
            try {
                recognizer = if (SpeechRecognizer.isOnDeviceRecognitionAvailable(app)) SpeechRecognizer.createOnDeviceSpeechRecognizer(app)
                else SpeechRecognizer.createSpeechRecognizer(app)
                val p = ParcelFileDescriptor.createPipe()
                pipe = p
                recognizer.setRecognitionListener(object : RecognitionListener {
                    override fun onResults(results: Bundle?) = finish(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull())
                    override fun onError(error: Int) { Log.i(TAG, "Recognizer error $error"); finish(null) }
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, p[0])
                    .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                    .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                    .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, pcm.sampleRate)
                recognizer.startListening(intent)
                // Feed the audio from a worker thread; closing the write end tells the recognizer the speech is over
                Thread {
                    runCatching {
                        ParcelFileDescriptor.AutoCloseOutputStream(p[1]).use { os ->
                            var off = 0
                            while (off < pcm.bytes.size) { val n = minOf(4096, pcm.bytes.size - off); os.write(pcm.bytes, off, n); off += n }
                        }
                    }
                }.start()
                main.postDelayed({ if (!finished) { Log.i(TAG, "Recognizer timed out"); finish(null) } }, timeoutMs)
            } catch (e: Exception) {
                Log.w(TAG, "Recognizer unavailable", e)
                finish(null)
            }
        }
    }
}
