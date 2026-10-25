package com.sanpan003.pocketarchive.offline

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.io.RandomAccessFile
import kotlin.random.Random

/** Encrypted media files: round trips, ranges (audio seeking), tampering, swapped chunks, wrong key, sizes */
class MediaVaultTest {
    @get:Rule val tmp = TemporaryFolder()
    private val key = Random(11).nextBytes(32)

    private fun vault(k: ByteArray = key) = MediaVault(tmp.root.resolve("v").apply { mkdirs() }, k)
    private fun store(v: MediaVault, name: String, data: ByteArray) { v.writer(name).use { w -> w.write(data); w.finish() } }

    @Test fun roundTripsEverySize() {
        val v = vault()
        for (size in listOf(0, 1, 1000, MediaVault.CHUNK - 1, MediaVault.CHUNK, MediaVault.CHUNK + 1, (3.5 * MediaVault.CHUNK).toInt())) {
            val data = Random(size).nextBytes(size)
            store(v, "f$size", data)
            assertArrayEquals("size $size", data, v.readAll("f$size", size.toLong()))
            assertEquals(MediaVault.storedSize(size.toLong()), v.file("f$size").length())
        }
    }

    @Test fun anyRangeReadsWithoutTheRest() {
        val v = vault()
        val data = Random(2).nextBytes(5 * MediaVault.CHUNK + 123)
        store(v, "audio", data)
        for ((a, b) in listOf(0L to 9L, 65_530L to 65_545L, 200_000L to 200_000L, (data.size - 10).toLong() to (data.size - 1).toLong())) {
            val got = v.open("audio", data.size.toLong(), a, b).use { it.readBytes() }
            assertArrayEquals("range $a-$b", data.copyOfRange(a.toInt(), b.toInt() + 1), got)
        }
    }

    @Test fun tamperingIsDetected() {
        val v = vault()
        val data = Random(3).nextBytes(100_000)
        store(v, "doc", data)
        RandomAccessFile(v.file("doc"), "rw").use { it.seek(500); val b = it.read(); it.seek(500); it.write(b xor 1) }
        var failed = false
        try { v.readAll("doc", data.size.toLong()) } catch (e: IOException) { failed = true }
        assertTrue(failed)
    }

    @Test fun chunksCantBeSwappedOrMovedToAnotherFile() {
        val v = vault()
        val a = Random(4).nextBytes(2 * MediaVault.CHUNK)
        store(v, "a", a)
        val raw = v.file("a").readBytes()
        val swapped = raw.copyOfRange(MediaVault.STRIDE, 2 * MediaVault.STRIDE) + raw.copyOfRange(0, MediaVault.STRIDE)
        v.file("a").writeBytes(swapped)
        var failed = false
        try { v.readAll("a", a.size.toLong()) } catch (e: IOException) { failed = true }
        assertTrue("swapped chunks", failed)
        store(v, "b", a)
        v.file("b").copyTo(v.file("c"))
        failed = false
        try { v.readAll("c", a.size.toLong()) } catch (e: IOException) { failed = true }
        assertTrue("a file copied under another name", failed)
    }

    @Test fun wrongKeyCantRead() {
        val data = Random(5).nextBytes(10_000)
        store(vault(), "x", data)
        var failed = false
        try { vault(Random(99).nextBytes(32)).readAll("x", data.size.toLong()) } catch (e: IOException) { failed = true }
        assertTrue(failed)
    }

    @Test fun resumeAppendsAfterWholeChunks() {
        val v = vault()
        val data = Random(6).nextBytes(3 * MediaVault.CHUNK + 50)
        v.writer("r").use { w -> w.write(data, 0, MediaVault.CHUNK + 1000) } // interrupted: 1 whole chunk on disk
        v.writer("r", startChunk = 1).use { w -> w.write(data, MediaVault.CHUNK, data.size - MediaVault.CHUNK); w.finish() }
        assertArrayEquals(data, v.readAll("r", data.size.toLong()))
    }

    @Test fun nothingReadableOnDisk() {
        val v = vault()
        val text = "Receipt Publix total 42.18 card ending 1234".repeat(50).toByteArray()
        store(v, "t", text)
        assertFalse(String(v.file("t").readBytes(), Charsets.ISO_8859_1).contains("Publix"))
    }
}
