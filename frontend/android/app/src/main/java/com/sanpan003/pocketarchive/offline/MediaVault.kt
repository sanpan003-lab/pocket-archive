package com.sanpan003.pocketarchive.offline

import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted media files of the offline copy (photos, scans, audio, recordings). Each file is a run of 64 KiB chunks,
 * each AES-256-GCM with its own random IV and the file name + chunk number as associated data (chunks can't be
 * swapped or moved). Any range can be read without decrypting the rest (audio seeking), and a download can resume
 * after the last whole chunk. The key lives in the encrypted database, so files are unreadable while it's locked.
 *
 *   chunk i at offset i * (12 + CHUNK + 16): IV (12) · ciphertext (≤ CHUNK) · tag (16)
 */
class MediaVault(val dir: File, key: ByteArray) {
    companion object {
        const val CHUNK = 64 * 1024
        const val IV = 12
        const val TAG = 16
        const val STRIDE = IV + CHUNK + TAG
        fun chunksFor(plainLength: Long): Long = (plainLength + CHUNK - 1) / CHUNK
        fun storedSize(plainLength: Long): Long = plainLength + chunksFor(plainLength) * (IV + TAG)
    }

    private val secret = SecretKeySpec(key.copyOf(), "AES")
    private val random = SecureRandom()

    init { dir.mkdirs() }

    fun file(name: String) = File(dir, name)
    fun exists(name: String) = file(name).exists()
    fun delete(name: String) { file(name).delete() }
    fun deleteAll() { dir.listFiles()?.forEach { it.delete() } }
    fun bytesOnDisk(): Long = dir.listFiles()?.sumOf { it.length() } ?: 0L

    private fun aad(name: String, index: Long): ByteArray =
        name.toByteArray(Charsets.UTF_8) + ByteBuffer.allocate(8).putLong(index).array()

    /** Write plain bytes as encrypted chunks, starting after [startChunk] whole chunks already on disk (resume) */
    fun writer(name: String, startChunk: Long = 0): Writer = Writer(name, startChunk)

    inner class Writer(private val name: String, startChunk: Long) : AutoCloseable {
        private val raf = RandomAccessFile(file(name), "rw")
        private val buf = ByteArray(CHUNK)
        private var fill = 0
        var chunks = startChunk
            private set

        init { raf.setLength(startChunk * STRIDE); raf.seek(startChunk * STRIDE) }

        /** Plain bytes written so far in whole chunks (safe to resume from) */
        val committedPlain: Long get() = chunks * CHUNK

        fun write(bytes: ByteArray, off: Int = 0, len: Int = bytes.size) {
            var o = off
            var left = len
            while (left > 0) {
                val n = minOf(left, CHUNK - fill)
                System.arraycopy(bytes, o, buf, fill, n)
                fill += n; o += n; left -= n
                if (fill == CHUNK) flushChunk()
            }
        }

        private fun flushChunk() {
            if (fill == 0) return
            val iv = ByteArray(IV).also { random.nextBytes(it) }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(TAG * 8, iv))
            c.updateAAD(aad(name, chunks))
            raf.write(iv)
            raf.write(c.doFinal(buf, 0, fill))
            chunks++
            fill = 0
        }

        /** The last, shorter chunk; then the file is complete */
        fun finish() { flushChunk(); raf.fd.sync() }

        override fun close() { raf.close() }
    }

    /** Decrypt one chunk (null when the file is shorter or tampered with) */
    private fun chunk(raf: RandomAccessFile, name: String, index: Long, plainLength: Long): ByteArray? {
        val plainLen = minOf(CHUNK.toLong(), plainLength - index * CHUNK).toInt()
        if (plainLen <= 0) return null
        val stored = ByteArray(IV + plainLen + TAG)
        raf.seek(index * STRIDE)
        if (raf.read(stored) != stored.size) return null
        return runCatching {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG * 8, stored, 0, IV))
            c.updateAAD(aad(name, index))
            c.doFinal(stored, IV, plainLen + TAG)
        }.getOrNull()
    }

    /** Plain bytes [from, to] (inclusive) as a stream, decrypting chunk by chunk */
    fun open(name: String, plainLength: Long, from: Long = 0, to: Long = plainLength - 1): InputStream {
        val raf = RandomAccessFile(file(name), "r")
        return object : InputStream() {
            private var pos = from
            private var cur: ByteArray? = null
            private var curIndex = -1L

            private fun load(): Boolean {
                val index = pos / CHUNK
                if (index != curIndex) {
                    cur = chunk(raf, name, index, plainLength) ?: return false
                    curIndex = index
                }
                return true
            }

            override fun read(): Int {
                val one = ByteArray(1)
                return if (read(one, 0, 1) == 1) one[0].toInt() and 0xff else -1
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (pos > to || len == 0) return -1
                if (!load()) throw java.io.IOException("The offline copy of this file is damaged")
                val inChunk = (pos % CHUNK).toInt()
                val n = minOf(len.toLong(), (cur!!.size - inChunk).toLong(), to - pos + 1).toInt()
                System.arraycopy(cur!!, inChunk, b, off, n)
                pos += n
                return n
            }

            override fun available(): Int = (to - pos + 1).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
            override fun close() = raf.close()
        }
    }

    /** The whole file (tests, small files) */
    fun readAll(name: String, plainLength: Long): ByteArray = open(name, plainLength).use { it.readBytes() }
}
