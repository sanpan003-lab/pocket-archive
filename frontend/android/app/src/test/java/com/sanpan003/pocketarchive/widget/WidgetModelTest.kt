package com.sanpan003.pocketarchive.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Widget 2.10.0: filters, actions hidden, sort, 50 max, Up next + countdown, inline actions, settings */
class WidgetModelTest {
    private val zone = ZoneId.of("America/New_York")
    private val now = ZonedDateTime.of(2026, 10, 26, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
    private fun at(h: Int, m: Int = 0, dayPlus: Long = 0) = ZonedDateTime.of(2026, 10, 26, h, m, 0, 0, zone).plusDays(dayPlus).toOffsetDateTime().toString()

    private fun n(id: String, type: String = "note", created: String = "2026-10-20T10:00:00Z", extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("id", id).put("title", "T $id").put("type", type).put("createdAt", created).apply(extra)

    private val notes = listOf(
        n("qn_1_note", created = "2026-10-25T10:00:00Z"),
        n("qn_1_rem", "reminder", "2026-10-24T10:00:00Z") { put("dueDate", at(12)); put("title", "Call Citibank") },
        n("qn_1_ev", "event", "2026-10-23T10:00:00Z") { put("start", at(15, 30, 1)) },
        n("qn_1_list", created = "2026-10-22T10:00:00Z") { put("format", "list"); put("items", JSONArray().put(JSONObject().put("id", "a").put("text", "Eggs").put("done", true)).put(JSONObject().put("id", "b").put("text", "Milk"))) },
        n("qn_1_err", "errand", "2026-10-21T10:00:00Z") { put("items", JSONArray()) },
        n("qn_1_doc", created = "2026-10-19T10:00:00Z") { put("document", JSONObject().put("type", "receipt")) },
        n("qn_1_shr", created = "2026-10-18T10:00:00Z") { put("sharedFrom", JSONObject().put("ownerId", "u_b")) },
        n("qn_1_act", "action", "2026-10-26T09:00:00Z") { put("action", JSONObject().put("kind", "alarm")) },
        n("qn_1_del", created = "2026-10-26T09:30:00Z") { put("undone", true) },
        n("qn_1_hid", created = "2026-10-26T09:30:00Z") { put("hidden", true) },
        n("qn_1_old", "reminder", "2026-10-01T10:00:00Z") { put("dueDate", at(8)) },
        n("qn_1_done", "reminder", "2026-10-02T10:00:00Z") { put("dueDate", at(11)); put("reminderDone", true) },
    )
    private fun ids(list: List<WidgetModel.Item>) = list.map { it.id }

    @Test fun allHidesActionsDeletedAndHidden() {
        val all = ids(WidgetModel.items(notes, "all", false, "newest", zone))
        assertFalse("actions off by default", "qn_1_act" in all)
        assertFalse("qn_1_del" in all); assertFalse("qn_1_hid" in all)
        assertEquals("newest first", "qn_1_note", all.first())
        assertTrue("with actions on", "qn_1_act" in ids(WidgetModel.items(notes, "all", true, "newest", zone)))
    }

    @Test fun eachChip() {
        assertEquals(listOf("qn_1_note", "qn_1_shr"), ids(WidgetModel.items(notes, "notes", false, "newest", zone)))
        assertEquals(setOf("qn_1_rem", "qn_1_ev", "qn_1_old", "qn_1_done"), ids(WidgetModel.items(notes, "reminders", false, "newest", zone)).toSet())
        assertEquals(listOf("qn_1_list", "qn_1_err"), ids(WidgetModel.items(notes, "lists", false, "newest", zone)))
        assertEquals(listOf("qn_1_doc"), ids(WidgetModel.items(notes, "documents", false, "newest", zone)))
        assertEquals(listOf("qn_1_shr"), ids(WidgetModel.items(notes, "shared", false, "newest", zone)))
        assertEquals(listOf("qn_1_act"), ids(WidgetModel.items(notes, "actions", false, "newest", zone)))
    }

    @Test fun dueSoonestPutsTimedOpenOnesFirst() {
        val due = ids(WidgetModel.items(notes, "all", false, "due", zone))
        assertEquals(listOf("qn_1_old", "qn_1_rem", "qn_1_ev"), due.take(3))
        assertTrue("done reminders after", due.indexOf("qn_1_done") > due.indexOf("qn_1_ev"))
    }

    @Test fun atMost50() {
        val many = (1..80).map { n("qn_1_m$it", created = "2026-10-${(it % 28 + 1).toString().padStart(2, '0')}T10:00:00Z") }
        assertEquals(50, WidgetModel.items(many, "all", false, "newest", zone).size)
    }

    @Test fun upNextNextThreeWithCountdown() {
        val next = WidgetModel.upNext(notes, now, zone)
        assertEquals(listOf("qn_1_rem", "qn_1_ev"), ids(next))
        assertEquals("Call Citibank · 12 PM · in 2 h", WidgetModel.upNextLine(next[0], now, false, zone))
        assertEquals("Event · Tomorrow 3:30 PM · in 30 h", WidgetModel.upNextLine(next[1], now, true, zone))
    }

    @Test fun countdowns() {
        assertEquals("now", WidgetModel.countdown(now, false, now))
        assertEquals("in 25 min", WidgetModel.countdown(now + 25 * 60_000, false, now))
        assertEquals("in 3 d", WidgetModel.countdown(now + 3 * 86_400_000L, false, now))
    }

    @Test fun privateTitles() {
        val items = WidgetModel.items(notes, "all", true, "newest", zone).associateBy { it.id }
        assertEquals("List", WidgetModel.privateTitle(items.getValue("qn_1_list")))
        assertEquals("Document", WidgetModel.privateTitle(items.getValue("qn_1_doc")))
        assertEquals("Reminder", WidgetModel.privateTitle(items.getValue("qn_1_rem")))
    }

    @Test fun listProgressAndActionsAllowed() {
        val items = WidgetModel.items(notes, "all", false, "newest", zone).associateBy { it.id }
        assertEquals("1/2", items.getValue("qn_1_list").progress)
        assertTrue(items.getValue("qn_1_rem").canDone && items.getValue("qn_1_rem").canSnooze)
        assertFalse(items.getValue("qn_1_ev").canDone)
    }

    // ── Inline actions ──────────────────────────────────────────────────────
    private val list = n("qn_1_list") { put("format", "list"); put("items", JSONArray().put(JSONObject().put("id", "a").put("text", "Eggs").put("done", false))) }

    @Test fun toggleQueuesAnItemOp() {
        val (local, op) = WidgetActions.plan("toggle", list, "a", null, now) { "x" }!!
        assertTrue(local!!.getJSONArray("items").getJSONObject(0).getBoolean("done"))
        assertTrue("last item checked → list done", local.getBoolean("errandDone"))
        assertEquals("/api/quick/qn_1_list/ops", op.getString("path"))
        val o = op.getJSONObject("body").getJSONArray("ops").getJSONObject(0)
        assertEquals("toggleItem", o.getString("op")); assertTrue(o.getBoolean("done"))
        assertNull("unknown item → nothing", WidgetActions.plan("toggle", list, "zzz", null, now) { "x" })
    }

    @Test fun addItemDoneSnoozeAndTextNote() {
        val (l1, add) = WidgetActions.plan("addItem", list, null, "  Bread ", now) { "x" }!!
        assertEquals(2, l1!!.getJSONArray("items").length())
        assertEquals("Bread", add.getJSONObject("body").getJSONArray("ops").getJSONObject(0).getString("text"))
        val rem = notes[1]
        val (l2, done) = WidgetActions.plan("done", rem, null, null, now) { "x" }!!
        assertTrue(l2!!.getBoolean("reminderDone"))
        assertEquals("/api/quick/qn_1_rem/done", done.getString("path"))
        val (l3, snooze) = WidgetActions.plan("snooze", rem, null, null, now) { "x" }!!
        assertEquals("PUT", snooze.getString("method"))
        assertEquals(l3!!.getString("dueDate"), snooze.getJSONObject("body").getString("dueDate"))
        val (note, create) = WidgetActions.plan("text", null, null, "Buy stamps\nat the post office", now) { "qn_1_offabcdef" }!!
        assertEquals("Buy stamps", note!!.getString("title"))
        assertTrue(create.getBoolean("createsNote"))
        assertEquals("qn_1_offabcdef", create.getString("tempId"))
        assertTrue(create.getJSONObject("body").getString("clientId").isNotBlank())
        assertNull("empty text → nothing", WidgetActions.plan("text", null, null, "   ", now) { "x" })
    }

    @Test fun snoozeIsAnHourFromNowWithOffset() {
        val t = WidgetModel.snoozeTime(now, 60, zone)
        assertEquals("2026-10-26T11:00:00-04:00", t)
    }

    // ── Settings ────────────────────────────────────────────────────────────
    @Test fun settingsRoundTripAndSafeDefaults() {
        val c = WidgetConfig(defaultFilter = "lists", chips = listOf("all", "lists"), showActions = true, sort = "due", density = "compact",
            theme = "light", opacity = 40, showTimes = false, hideTitles = true, upNext = false, listId = "qn_1_list", filter = "lists")
        assertEquals(c, WidgetConfig.fromJson(c.toJson()))
        val bad = WidgetConfig.fromJson(JSONObject().put("defaultFilter", "everything").put("opacity", 900).put("filter", "actions"))
        assertEquals("all", bad.defaultFilter); assertEquals(100, bad.opacity)
        assertEquals("actions chip can't be selected while actions are off", "all", bad.filter)
        assertFalse("actions" in WidgetConfig().shownChips)
        assertTrue("actions" in WidgetConfig(showActions = true, chips = WidgetModel.FILTERS).shownChips)
    }
}
