package com.sanpan003.pocketarchive.offline

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What each "What to keep" mode downloads, Keep offline, recordings, maps, the storage limit, settings JSON */
class MediaPlanTest {
    private val now = java.time.Instant.parse("2026-10-25T12:00:00Z").toEpochMilli()
    private val recent = NoteInfo(false, "2026-10-20T10:00:00Z", null)
    private val old = NoteInfo(false, "2025-01-01T10:00:00Z", "pj_1_proj")
    private val pinnedOld = NoteInfo(true, "2025-01-01T10:00:00Z", null)
    private fun row(kind: String, note: String? = "qn_1_a", rec: String? = null) = MediaRow("/k/$kind/$note/$rec", null, kind, 100, note, rec)

    private fun wanted(mode: String, r: MediaRow, n: NoteInfo?, keep: List<String> = emptyList(), admin: Boolean = false, archive: Boolean = true, maps: Boolean = false) =
        MediaPlan.wanted(r, n, OfflineSettings(mode = mode, keepIds = keep, archive = archive, maps = maps), admin, now)

    @Test fun everythingKeepsAllNoteMedia() {
        for (k in listOf("photo", "scan", "file", "audio", "thumb")) assertTrue(k, wanted("everything", row(k), old))
    }

    @Test fun thumbsModeOnlyThumbnails() {
        assertTrue(wanted("thumbs", row("thumb"), old))
        assertFalse(wanted("thumbs", row("photo"), old))
        assertFalse(wanted("thumbs", row("audio"), recent))
    }

    @Test fun textModeNothing() {
        for (k in listOf("photo", "thumb", "audio")) assertFalse(k, wanted("text", row(k), recent))
    }

    @Test fun recentModePinnedAndLast30Days() {
        assertTrue(wanted("recent", row("photo"), recent))
        assertTrue(wanted("recent", row("photo"), pinnedOld))
        assertFalse(wanted("recent", row("photo"), old))
        assertTrue("thumbnails always", wanted("recent", row("thumb"), old))
    }

    @Test fun keepOfflineWinsInEveryMode() {
        for (m in listOf("thumbs", "text", "recent")) {
            assertTrue("note $m", wanted(m, row("audio", "qn_1_a"), old, keep = listOf("qn_1_a")))
            assertTrue("project $m", wanted(m, row("photo", "qn_1_a"), old, keep = listOf("pj_1_proj")))
        }
    }

    @Test fun recordingsOnlyForTheAdminWithEverything() {
        val r = row("recording", null, "2026-01-01_x")
        assertFalse(wanted("everything", r, null, admin = false))
        assertTrue(wanted("everything", r, null, admin = true))
        assertFalse(wanted("everything", r, null, admin = true, archive = false))
        assertFalse(wanted("thumbs", r, null, admin = true))
    }

    @Test fun mapsOnlyWhenSwitchedOn() {
        assertFalse(wanted("everything", row("map", null), null))
        assertTrue(wanted("everything", row("map", null), null, maps = true))
    }

    @Test fun limitFitsThumbsAndPinnedFirst() {
        val rows = listOf(
            MediaRow("a", null, "photo", 400, "qn_1_old"),
            MediaRow("b", null, "photo", 400, "qn_1_pin"),
            MediaRow("t", null, "thumb", 50, "qn_1_old"),
            MediaRow("c", null, "audio", 400, "qn_1_recent"),
        )
        val notes = mapOf("qn_1_old" to old.copy(projectId = null), "qn_1_pin" to pinnedOld, "qn_1_recent" to recent)
        val planned = MediaPlan.plan(rows, notes, OfflineSettings(limitBytes = 1000), false, 100, now).associateBy { it.key }
        assertEquals("want", planned.getValue("t").state)
        assertEquals("want", planned.getValue("b").state)
        assertEquals("want", planned.getValue("c").state)
        assertEquals("skip", planned.getValue("a").state)
    }

    @Test fun noLimitKeepsEverythingAndHaveStaysHave() {
        val rows = listOf(MediaRow("a", null, "photo", 400, "qn_1_x", state = "have"), MediaRow("b", null, "photo", 400, "qn_1_x"))
        val planned = MediaPlan.plan(rows, emptyMap(), OfflineSettings(), false, 0, now).associateBy { it.key }
        assertEquals("have", planned.getValue("a").state)
        assertEquals("want", planned.getValue("b").state)
    }

    @Test fun settingsSurviveJsonAndRejectNonsense() {
        val s = OfflineSettings(mode = "recent", wifiOnlyMedia = false, limitBytes = 5_000_000_000, archive = false, maps = true, keepIds = listOf("qn_1_a"))
        assertEquals(s, OfflineSettings.fromJson(s.toJson()))
        val bad = OfflineSettings.fromJson(JSONObject().put("mode", "all-the-things").put("limitBytes", -5))
        assertEquals("everything", bad.mode)
        assertEquals(0L, bad.limitBytes)
    }

    @Test fun fileNamesRevealNothing() {
        val n = MediaRow.fileName("/api/quick/qn_1792_abc/attachments/att_9")
        assertEquals(40, n.length)
        assertFalse(n.contains("qn_"))
    }
}
