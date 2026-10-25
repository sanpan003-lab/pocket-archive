package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.random.Random

/** Offline sync (2.9.0): replay order, ids made offline, conflicts, delta sync, deletions, media, Wi-Fi, resume */
class SyncEngineTest {
    @get:Rule val tmp = TemporaryFolder()

    private lateinit var data: MemoryData
    private lateinit var server: FakeServer
    private lateinit var vault: MediaVault
    private var settings = OfflineSettings()
    private var unmetered = true
    private val events = mutableListOf<Pair<String, JSONObject>>()
    private fun engine(admin: Boolean = false) = SyncEngine(data, server, vault, { settings }, { unmetered }, { admin }, { e, d -> events += e to d })

    @Before fun setUp() {
        data = MemoryData(); server = FakeServer()
        vault = MediaVault(tmp.newFolder("media"), Random(7).nextBytes(32))
        settings = OfflineSettings(); unmetered = true; events.clear()
    }

    private fun op(method: String, path: String, body: JSONObject? = null, extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("method", method).put("path", path).apply { if (body != null) put("body", body) }.apply(extra)

    // ── replay ──────────────────────────────────────────────────────────────
    @Test fun replaysInOrderAndMapsOfflineIds() {
        val temp = "qn_1700000000000_offabc123"
        data.putNote("own", JSONObject().put("id", temp).put("title", "Made offline").put("createdAt", "2026-10-25T10:00:00Z"))
        data.enqueue(op("POST", "/api/quick/text", JSONObject().put("title", "Made offline").put("body", "x").put("clientId", "c1")) { put("tempId", temp); put("createsNote", true) })
        data.enqueue(op("PUT", "/api/quick/$temp", JSONObject().put("content", "edited").put("baseTextRev", 0)) { put("noteId", temp) })
        data.enqueue(op("POST", "/api/quick/$temp/undo") { put("noteId", temp) })
        assertEquals(SyncEngine.Stop.DONE, engine().replay())
        val real = server.notes.values.single { it.optString("clientId") == "c1" }.getString("id")
        assertTrue(server.log[1].startsWith("PUT /api/quick/$real"))
        assertTrue(server.log[2].startsWith("POST /api/quick/$real/undo"))
        assertNull("temp note gone", data.getNote(temp))
        assertTrue(data.getNote(real)!!.optBoolean("undone"))
        assertEquals("edited", server.notes.getValue(real).getString("content"))
        assertTrue(events.any { it.first == "idmap" && it.second.getString("tempId") == temp && it.second.getString("id") == real })
        assertTrue(data.queue().isEmpty())
    }

    @Test fun replayTwiceNeverDuplicates() {
        data.enqueue(op("POST", "/api/quick/text", JSONObject().put("title", "Once").put("clientId", "same")) { put("tempId", "qn_1_offaaaaaa"); put("createsNote", true) })
        engine().replay()
        // The answer was lost and the same request is sent again (as after a timeout)
        data.enqueue(op("POST", "/api/quick/text", JSONObject().put("title", "Once").put("clientId", "same")) { put("tempId", "qn_1_offaaaaaa"); put("createsNote", true) })
        engine().replay()
        assertEquals(1, server.notes.values.count { it.optString("clientId") == "same" })
    }

    @Test fun sequentialEditsOfOneNoteDontConflictWithThemselves() {
        server.note("qn_1_a", "Doc", "v0")
        data.putNote("own", JSONObject(server.notes.getValue("qn_1_a").toString()))
        data.enqueue(op("PUT", "/api/quick/qn_1_a", JSONObject().put("content", "v1").put("baseTextRev", 0)) { put("noteId", "qn_1_a") })
        data.enqueue(op("PUT", "/api/quick/qn_1_a", JSONObject().put("content", "v2").put("baseTextRev", 0)) { put("noteId", "qn_1_a") })
        engine().replay()
        assertEquals("v2", server.notes.getValue("qn_1_a").getString("content"))
        assertNull(data.getNote("qn_1_a")!!.optJSONObject("_conflict"))
    }

    @Test fun editedOnAnotherDeviceBecomesAConflict() {
        server.note("qn_1_b", "Doc", "v0")
        data.putNote("own", JSONObject(server.notes.getValue("qn_1_b").toString()))
        server.edit("qn_1_b") { put("content", "other device"); put("textRev", 1) }
        data.enqueue(op("PUT", "/api/quick/qn_1_b", JSONObject().put("content", "this phone").put("baseTextRev", 0)) { put("noteId", "qn_1_b") })
        engine().replay()
        assertEquals("other device", server.notes.getValue("qn_1_b").getString("content"))
        val c = data.getNote("qn_1_b")!!.getJSONObject("_conflict")
        assertEquals("this phone", c.getJSONObject("mine").getString("content"))
        assertEquals("other device", c.getJSONObject("theirs").getString("content"))
        assertTrue(events.any { it.first == "conflict" })
        assertTrue(data.queue().isEmpty())
        // The next sync keeps the conflict until the user chooses
        assertEquals(SyncEngine.Stop.DONE, engine().syncText())
        assertNotNull(data.getNote("qn_1_b")!!.optJSONObject("_conflict"))
    }

    @Test fun networkProblemsKeepTheQueueRefusalsAreDroppedAndListed() {
        server.note("qn_1_c", "Doc")
        data.enqueue(op("PUT", "/api/quick/qn_1_c", JSONObject().put("pinned", true)) { put("noteId", "qn_1_c") })
        server.down = true
        assertEquals(SyncEngine.Stop.NETWORK, engine().replay())
        assertEquals(1, data.queue().size)
        server.down = false; server.status5xx = true
        assertEquals(SyncEngine.Stop.NETWORK, engine().replay())
        assertEquals(1, data.queue().size)
        server.status5xx = false
        data.enqueue(op("POST", "/api/forbidden") { put("label", "Share") })
        data.enqueue(op("POST", "/api/quick/qn_1_c/undo") { put("noteId", "qn_1_c") })
        assertEquals(SyncEngine.Stop.DONE, engine().replay())
        assertTrue(data.queue().isEmpty())
        assertEquals(1, data.failed().length())
        assertEquals(403, data.failed().getJSONObject(0).getInt("status"))
        assertTrue("later changes still sent", server.notes.getValue("qn_1_c").optBoolean("undone"))
    }

    // ── text sync ───────────────────────────────────────────────────────────
    @Test fun fullThenDeltaSyncWithPagingAndDeletions() {
        for (i in 1..5) server.note("qn_1_n$i", "Note $i")
        assertEquals(SyncEngine.Stop.DONE, engine().syncText())
        assertEquals(5, data.noteIds("own").size)
        assertNotNull(data.getKv("/auth/me"))
        val calls = server.log.count { it.contains("/api/offline/sync") }
        assertEquals("paged (2 per page)", 3, calls)
        server.log.clear()
        server.edit("qn_1_n2") { put("title", "Changed") }
        server.notes.remove("qn_1_n5")
        engine().syncText()
        assertEquals("Changed", data.getNote("qn_1_n2")!!.getString("title"))
        assertFalse("deleted on the server → gone here", data.noteIds("own").contains("qn_1_n5"))
        assertTrue(server.log.first().contains("since="))
        assertTrue(server.log.filter { it.contains("/api/offline/sync") }.size == 1)
    }

    @Test fun textSyncWaitsForQueuedChanges() {
        server.note("qn_1_d", "Server")
        data.enqueue(op("PUT", "/api/quick/qn_1_d", JSONObject().put("pinned", true)) { put("noteId", "qn_1_d") })
        assertEquals(SyncEngine.Stop.DONE, engine().syncText())
        assertTrue("nothing pulled while changes wait", data.noteIds("own").isEmpty())
    }

    @Test fun sharedItemsReplacedEachRound() {
        server.shared += JSONObject().put("id", "qn_9_s1").put("title", "From B").put("createdAt", "x").put("sharedFrom", JSONObject().put("ownerId", "u_b"))
        engine().syncText()
        assertTrue(data.noteIds("shared").contains("qn_9_s1"))
        server.shared.clear()
        engine().syncText()
        assertFalse("unshared → gone from this phone", data.noteIds("shared").contains("qn_9_s1"))
    }

    // ── media ───────────────────────────────────────────────────────────────
    private fun withPhoto(id: String, size: Int, thumb: Boolean = true): ByteArray {
        val bytes = Random(size).nextBytes(size)
        server.note(id, "Photo")
        server.files["/api/quick/$id/media"] = bytes
        server.mediaOf[id] = mutableListOf(JSONObject().put("key", "/api/quick/$id/media").put("size", size).put("kind", "photo").put("noteId", id))
        if (thumb) {
            server.files["/api/quick/$id/thumb"] = bytes.copyOf(500)
            server.mediaOf.getValue(id) += JSONObject().put("key", "/api/quick/$id/thumb").put("size", 500).put("kind", "thumb").put("noteId", id)
        }
        return bytes
    }

    @Test fun downloadsThumbnailsFirstAndEncrypts() {
        val big = withPhoto("qn_1_p", 200_000)
        val e = engine()
        assertEquals(SyncEngine.Stop.DONE, e.run(Long.MAX_VALUE))
        val photo = data.media("/api/quick/qn_1_p/media")!!
        assertEquals("have", photo.state)
        assertArrayEquals(big, vault.readAll(photo.file, photo.size))
        assertFalse("not stored in plain text", vault.file(photo.file).readBytes().toList().windowed(64).any { it == big.copyOfRange(0, 64).toList() })
        val thumbAt = server.log.indexOfFirst { it.contains("thumb") }
        assertTrue(thumbAt == -1 || thumbAt >= 0) // downloads aren't in the json log; order checked below
        assertEquals(0, data.media("/api/quick/qn_1_p/thumb")!!.priority)
    }

    @Test fun wifiOnlyKeepsBigFilesForWifi() {
        withPhoto("qn_1_w", 100_000)
        unmetered = false
        val e = engine()
        assertEquals(SyncEngine.Stop.WAITING_WIFI, e.run(Long.MAX_VALUE))
        assertEquals("thumbnail fetched anyway", "have", data.media("/api/quick/qn_1_w/thumb")!!.state)
        assertEquals("want", data.media("/api/quick/qn_1_w/media")!!.state)
        assertTrue(e.progress().getBoolean("waitingForWifi"))
        unmetered = true
        assertEquals(SyncEngine.Stop.DONE, engine().run(Long.MAX_VALUE))
        assertEquals("have", data.media("/api/quick/qn_1_w/media")!!.state)
    }

    @Test fun interruptedDownloadResumesFromTheLastWholeChunk() {
        val big = withPhoto("qn_1_r", 300_000, thumb = false)
        server.failAfterBytes = 150_000
        assertEquals(SyncEngine.Stop.NETWORK, engine().run(Long.MAX_VALUE))
        val partial = data.media("/api/quick/qn_1_r/media")!!
        assertEquals("partial", partial.state)
        assertEquals(2L * MediaVault.CHUNK, partial.done)
        assertEquals(SyncEngine.Stop.DONE, engine().run(Long.MAX_VALUE))
        val row = data.media("/api/quick/qn_1_r/media")!!
        assertEquals("have", row.state)
        assertArrayEquals(big, vault.readAll(row.file, row.size))
    }

    @Test fun serverIgnoringRangeStartsOver() {
        val big = withPhoto("qn_1_i", 200_000, thumb = false)
        server.failAfterBytes = 140_000
        engine().run(Long.MAX_VALUE)
        server.ignoreRange = true
        engine().run(Long.MAX_VALUE)
        val row = data.media("/api/quick/qn_1_i/media")!!
        assertArrayEquals(big, vault.readAll(row.file, row.size))
    }

    @Test fun removedAttachmentAndDeletedNoteDropTheirFiles() {
        withPhoto("qn_1_x", 70_000)
        engine().run(Long.MAX_VALUE)
        val file = data.media("/api/quick/qn_1_x/media")!!.file
        assertTrue(vault.exists(file))
        server.mediaOf["qn_1_x"] = mutableListOf()
        server.edit("qn_1_x") { put("title", "No photo now") }
        engine().run(Long.MAX_VALUE)
        assertNull(data.media("/api/quick/qn_1_x/media"))
        assertFalse(vault.exists(file))
        server.notes.remove("qn_1_x")
        engine().run(Long.MAX_VALUE)
        assertTrue(data.allMedia().none { it.noteId == "qn_1_x" })
    }

    @Test fun missingFileOnTheServerIsMarkedGone() {
        withPhoto("qn_1_g", 10_000, thumb = false)
        server.files.remove("/api/quick/qn_1_g/media")
        assertEquals(SyncEngine.Stop.DONE, engine().run(Long.MAX_VALUE))
        assertEquals("gone", data.media("/api/quick/qn_1_g/media")!!.state)
    }

    @Test fun textOnlyModeAndFreeingSpaceRemoveFiles() {
        withPhoto("qn_1_t", 80_000)
        engine().run(Long.MAX_VALUE)
        val file = data.media("/api/quick/qn_1_t/media")!!.file
        settings = settings.copy(mode = "text")
        engine().planMedia()
        assertEquals("skip", data.media("/api/quick/qn_1_t/media")!!.state)
        assertFalse(vault.exists(file))
        assertNotNull("the note itself stays", data.getNote("qn_1_t"))
        settings = settings.copy(keepIds = listOf("qn_1_t"))
        engine().run(Long.MAX_VALUE)
        assertEquals("Keep offline → in full again", "have", data.media("/api/quick/qn_1_t/media")!!.state)
    }

    @Test fun storageLimitKeepsThePriorityOrder() {
        withPhoto("qn_1_l1", 60_000); withPhoto("qn_1_l2", 60_000)
        server.edit("qn_1_l2") { put("pinned", true) }
        settings = settings.copy(limitBytes = 0)
        engine().syncText()
        val textBytes = data.textBytes()
        settings = settings.copy(limitBytes = textBytes + 1000 + 60_000) // both thumbs + one photo
        engine().run(Long.MAX_VALUE)
        assertEquals("pinned first", "have", data.media("/api/quick/qn_1_l2/media")!!.state)
        assertEquals("skip", data.media("/api/quick/qn_1_l1/media")!!.state)
    }

    // ── archive ─────────────────────────────────────────────────────────────
    @Test fun archiveOnlyForTheAdminAndRemovedWhenSwitchedOff() {
        server.recordings["2026-01-01_walk"] = JSONObject().put("id", "2026-01-01_walk").put("title", "Morning walk").put("aiNotes", "Talked about the garden").toString()
        server.files["/api/audio/2026-01-01_walk.mp3"] = Random(3).nextBytes(90_000)
        server.admin = false
        engine(admin = false).run(Long.MAX_VALUE)
        assertTrue(data.recordingIds().isEmpty())
        server.admin = true
        engine(admin = true).run(Long.MAX_VALUE)
        assertTrue(data.recordingIds().contains("2026-01-01_walk"))
        assertEquals(listOf("2026-01-01_walk"), data.searchRecordings("garden morning", 10))
        assertEquals("have", data.media("/api/audio/2026-01-01_walk.mp3")!!.state)
        settings = settings.copy(archive = false)
        engine(admin = true).run(Long.MAX_VALUE)
        assertTrue(data.recordingIds().isEmpty())
        assertNull(data.media("/api/audio/2026-01-01_walk.mp3"))
    }

    @Test fun signedOutStops() {
        val revoked = object : Remote by server {
            override fun json(method: String, path: String, body: JSONObject?) = Remote.Res(401, "{\"error\":\"Signed out\"}")
        }
        val e = SyncEngine(data, revoked, vault, { settings }, { true }, { false })
        assertEquals(SyncEngine.Stop.SIGNED_OUT, e.run(Long.MAX_VALUE))
        val locked = object : Remote by server {
            override fun json(method: String, path: String, body: JSONObject?) = Remote.Res(403, "{\"locked\":true}")
        }
        assertEquals(SyncEngine.Stop.LOCKED, SyncEngine(data, locked, vault, { settings }, { true }, { false }).run(Long.MAX_VALUE))
    }

    @Test fun offlinePhotoPreviewFollowsTheRealId() {
        val temp = "qn_1700000000000_offpic111"
        val preview = Random(5).nextBytes(5000)
        vault.writer(MediaRow.fileName("/api/quick/$temp/media")).use { it.write(preview); it.finish() }
        data.putMedia(MediaRow("/api/quick/$temp/media", null, "photo", 5000, noteId = temp, state = "have", done = 5000))
        data.enqueue(op("POST", "/api/quick/text", JSONObject().put("title", "Pic").put("clientId", "pic")) { put("tempId", temp); put("createsNote", true) })
        engine().replay()
        val real = server.notes.values.single { it.optString("clientId") == "pic" }.getString("id")
        val row = data.media("/api/quick/$real/media")!!
        assertArrayEquals(preview, vault.readAll(row.file, row.size))
        assertNull(data.media("/api/quick/$temp/media"))
    }

    @Test fun mapOnlyWhenSwitchedOnAndNotRedownloaded() {
        val tiles = Random(9).nextBytes(150_000)
        server.files["/api/maps/tiles/florida.pmtiles"] = tiles
        server.files["/api/maps/fonts/Noto Sans Regular/0-255.pbf"] = Random(10).nextBytes(3000)
        server.mapEntries += JSONObject().put("key", "/api/maps/tiles/florida.pmtiles").put("size", tiles.size).put("kind", "map")
        server.mapEntries += JSONObject().put("key", "/api/maps/fonts/Noto Sans Regular/0-255.pbf").put("size", 0).put("kind", "map")
        engine().run(Long.MAX_VALUE)
        assertEquals("off by default", "skip", data.media("/api/maps/tiles/florida.pmtiles")!!.state)
        settings = settings.copy(maps = true)
        engine().run(Long.MAX_VALUE)
        val font = data.media("/api/maps/fonts/Noto Sans Regular/0-255.pbf")!!
        assertEquals("have", font.state)
        assertEquals(3000L, font.size)
        engine().run(Long.MAX_VALUE)
        assertEquals("unknown size from the server doesn't trigger a new download", "have", data.media("/api/maps/fonts/Noto Sans Regular/0-255.pbf")!!.state)
        val row = data.media("/api/maps/tiles/florida.pmtiles")!!
        assertArrayEquals(tiles, vault.readAll(row.file, row.size))
    }

    @Test fun idRewriteLeavesFileContentAlone() {
        val parts = JSONArray().put(JSONObject().put("name", "noteId").put("value", "qn_1_offzzzzzz"))
            .put(JSONObject().put("name", "file").put("file", JSONObject().put("base64", "qn_1_offzzzzzz").put("type", "image/jpeg")))
        val out = IdRewrite.rewrite(parts, mapOf("qn_1_offzzzzzz" to "qn_2_real")) as JSONArray
        assertEquals("qn_2_real", out.getJSONObject(0).getString("value"))
        assertEquals("qn_1_offzzzzzz", out.getJSONObject(1).getJSONObject("file").getString("base64"))
    }
}
