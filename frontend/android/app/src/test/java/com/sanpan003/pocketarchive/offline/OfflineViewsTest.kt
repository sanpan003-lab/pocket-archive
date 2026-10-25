package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Widget + watch lists from the offline copy follow the server's rules */
class OfflineViewsTest {
    private fun note(id: String, at: String, extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("id", id).put("title", "T $id").put("createdAt", at).put("type", "note").apply(extra)

    @Test fun recentIsNewestFirstWithoutDeletedOrHidden() {
        val list = listOf(
            note("qn_1_a", "2026-10-20T10:00:00Z"),
            note("qn_1_b", "2026-10-22T10:00:00Z") { put("undone", true) },
            note("qn_1_c", "2026-10-23T10:00:00Z") { put("hidden", true) },
            note("qn_1_d", "2026-10-24T10:00:00Z") { put("type", "errand"); put("items", JSONArray().put(JSONObject().put("id", "i").put("text", "Eggs").put("done", true))) },
            note("qn_1_e", "2026-10-21T10:00:00Z") { put("type", "action"); put("action", JSONObject().put("kind", "alarm")) },
        )
        val r = OfflineViews.recent(list, 5, true)
        assertEquals(listOf("qn_1_d", "qn_1_e", "qn_1_a"), (0 until r.length()).map { r.getJSONObject(it).getString("id") })
        assertEquals(1, r.getJSONObject(0).getInt("itemsDone"))
        assertEquals("⏰", r.getJSONObject(1).getString("icon"))
        assertTrue(r.getJSONObject(2).has("summary"))
    }

    @Test fun openErrandsIncludeSharedAndSkipDone() {
        val own = listOf(note("qn_1_a", "2026-10-20T10:00:00Z") { put("type", "errand"); put("trigger", "arrival"); put("place", JSONObject().put("name", "Publix")) },
            note("qn_1_b", "2026-10-21T10:00:00Z") { put("type", "errand"); put("errandDone", true) })
        val shared = listOf(note("qn_2_s", "2026-10-22T10:00:00Z") { put("type", "errand"); put("sharedFrom", JSONObject().put("ownerId", "u_b")) })
        val e = OfflineViews.openErrands(own, shared)
        val ids = (0 until e.length()).map { e.getJSONObject(it).getString("id") }
        assertEquals(listOf("qn_2_s", "qn_1_a"), ids)
        assertEquals("Publix", e.getJSONObject(1).getString("placeName"))
        assertTrue(e.getJSONObject(1).getBoolean("arrival"))
        assertFalse(ids.contains("qn_1_b"))
    }
}
