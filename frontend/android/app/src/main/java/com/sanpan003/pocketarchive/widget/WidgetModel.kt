package com.sanpan003.pocketarchive.widget

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What the widgets show (2.10.0), from note JSON — the offline copy's notes, or the server's GET /api/quick/recent?full=1
 * answer (same field names). Pure: unit tested on the JVM.
 */
object WidgetModel {
    const val MAX_ITEMS = 50

    /** Filter chips, in order. Actions are off unless switched on. */
    val FILTERS = listOf("all", "notes", "reminders", "lists", "documents", "shared", "actions")
    val FILTER_LABEL = mapOf("all" to "All", "notes" to "Notes", "reminders" to "Reminders", "lists" to "Lists", "documents" to "Docs", "shared" to "Shared", "actions" to "Actions")

    data class ListItem(val id: String, val text: String, val done: Boolean)

    data class Item(
        val id: String,
        val title: String,
        val type: String,             // note | reminder | event | errand | note_link | action
        val icon: String,             // emoji for the row
        val createdAt: String?,
        val due: Long?,               // epoch ms of the reminder / event time (null: none)
        val allDay: Boolean,
        val isList: Boolean,
        val isDocument: Boolean,
        val shared: Boolean,
        val pinned: Boolean,
        val done: Boolean,
        val needsReview: Boolean,
        val items: List<ListItem>,
    ) {
        val progress: String? get() = if (isList && items.isNotEmpty()) "${items.count { it.done }}/${items.size}" else null
        val isReminder get() = type == "reminder" || type == "event"
        val canDone get() = type == "reminder" && !done
        val canSnooze get() = type == "reminder" && !done && due != null
    }

    private val ICON = mapOf("event" to "📅", "reminder" to "⏰", "errand" to "🛒", "note_link" to "🔗", "note" to "📝")
    private val ACTION_ICON = mapOf("alarm" to "⏰", "timer" to "⏲", "navigate" to "📍", "message" to "💬", "call" to "📞", "dnd" to "🔕", "flashlight" to "🔦", "openApp" to "📱")

    /** "2026-10-26" (all day) or an ISO time with offset → epoch ms (all-day: start of that day here) */
    fun parseWhen(value: String?, zone: ZoneId = ZoneId.systemDefault()): Pair<Long, Boolean>? {
        if (value.isNullOrBlank()) return null
        return runCatching {
            if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)) LocalDate.parse(value).atStartOfDay(zone).toInstant().toEpochMilli() to true
            else ZonedDateTime.parse(value).toInstant().toEpochMilli() to false
        }.recoverCatching { Instant.parse(value).toEpochMilli() to false }.getOrNull()
    }

    fun itemOf(n: JSONObject, zone: ZoneId = ZoneId.systemDefault()): Item? {
        val id = n.optString("id").takeIf { it.startsWith("qn_") } ?: return null
        val type = n.optString("type", "note").ifBlank { "note" }
        val format = n.optString("format").takeIf { it.isNotBlank() && it != "null" }
        val itemsJson = n.optJSONArray("items") ?: JSONArray()
        val items = (0 until itemsJson.length()).mapNotNull { i ->
            itemsJson.optJSONObject(i)?.let { ListItem(it.optString("id"), it.optString("text"), it.optBoolean("done")) }
        }
        val isList = type == "errand" || format == "list"
        val whenStr = when (type) { "event" -> n.optString("start"); "reminder" -> n.optString("dueDate"); "errand" -> n.optString("start"); else -> null }
            ?.takeIf { it.isNotBlank() && it != "null" }
        val due = parseWhen(whenStr, zone)
        val isDocument = n.optJSONObject("document")?.optString("type")?.isNotBlank() == true || n.optBoolean("isDocument")
        val shared = n.has("sharedFrom") && !n.isNull("sharedFrom") || n.optBoolean("shared") || (n.optJSONArray("sharedWith")?.length() ?: 0) > 0
        val icon = when {
            type == "action" -> n.optString("icon").ifBlank { ACTION_ICON[n.optJSONObject("action")?.optString("kind")] ?: "⚡" }
            isDocument -> "🧾"
            isList && type != "errand" -> "☑️"
            else -> ICON[type] ?: "📝"
        }
        val done = n.optBoolean("errandDone") || n.optBoolean("reminderDone") || (isList && items.isNotEmpty() && items.all { it.done })
        return Item(
            id = id, title = n.optString("title").ifBlank { "Untitled" }, type = type, icon = icon,
            createdAt = n.optString("capturedAt").ifBlank { n.optString("createdAt") }.ifBlank { null },
            due = due?.first, allDay = due?.second == true, isList = isList, isDocument = isDocument, shared = shared,
            pinned = n.optBoolean("pinned"), done = done, needsReview = n.optString("status") == "needs_review" || n.optBoolean("needsReview"),
            items = items,
        )
    }

    private fun visible(n: JSONObject) = !n.optBoolean("undone") && !n.optBoolean("hidden") && n.optString("kind") != "append"

    fun matches(it: Item, filter: String, showActions: Boolean): Boolean = when (filter) {
        "notes" -> (it.type == "note" || it.type == "note_link") && !it.isList && !it.isDocument
        "reminders" -> it.isReminder
        "lists" -> it.isList
        "documents" -> it.isDocument
        "shared" -> it.shared && it.type != "action"
        "actions" -> it.type == "action"
        else -> it.type != "action" || showActions
    }

    /** The widget's list: filter, sort (newest | due), at most 50 */
    fun items(notes: List<JSONObject>, filter: String, showActions: Boolean, sort: String, zone: ZoneId = ZoneId.systemDefault()): List<Item> {
        val all = notes.filter(::visible).mapNotNull { itemOf(it, zone) }.filter { matches(it, filter, showActions) }
        val sorted = if (sort == "due") {
            all.sortedWith(compareBy<Item> { if (it.due == null || it.done) 1 else 0 }.thenBy { it.due ?: Long.MAX_VALUE }.thenByDescending { it.createdAt ?: "" })
        } else all.sortedByDescending { it.createdAt ?: "" }
        return sorted.take(MAX_ITEMS)
    }

    /** "Up next": the next 3 reminders / events from now (all-day ones count for their whole day) */
    fun upNext(notes: List<JSONObject>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<Item> =
        notes.filter(::visible).mapNotNull { itemOf(it, zone) }
            .filter { it.isReminder && !it.done && it.due != null && (if (it.allDay) it.due + 86_400_000L > now else it.due >= now - 60_000L) }
            .sortedBy { it.due }
            .take(3)

    /** "12 PM", "Tue 3:30 PM", "Today" (all day) */
    fun timeLabel(due: Long, allDay: Boolean, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val t = Instant.ofEpochMilli(due).atZone(zone)
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val d = t.toLocalDate()
        val dayPart = when (d) {
            today -> if (allDay) "Today" else null
            today.plusDays(1) -> "Tomorrow"
            else -> if (d.isBefore(today.plusDays(7))) t.format(DateTimeFormatter.ofPattern("EEE", Locale.US)) else t.format(DateTimeFormatter.ofPattern("MMM d", Locale.US))
        }
        if (allDay) return dayPart ?: "Today"
        val time = if (t.minute == 0) t.format(DateTimeFormatter.ofPattern("h a", Locale.US)) else t.format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))
        return if (dayPart == null) time else "$dayPart $time"
    }

    /** "in 2 h", "in 25 min", "now", "in 3 d" */
    fun countdown(due: Long, allDay: Boolean, now: Long): String {
        if (allDay) return if (due <= now) "today" else "in ${((due - now) / 86_400_000L) + 1} d"
        val m = (due - now) / 60_000L
        return when {
            m <= 0 -> "now"
            m < 60 -> "in $m min"
            m < 48 * 60 -> "in ${(m + 30) / 60} h"
            else -> "in ${m / (24 * 60)} d"
        }
    }

    /** "Call Citibank · 12 PM · in 2 h" */
    fun upNextLine(it: Item, now: Long, hideTitles: Boolean, zone: ZoneId = ZoneId.systemDefault()): String {
        val title = if (hideTitles) (if (it.type == "event") "Event" else "Reminder") else it.title
        val due = it.due ?: return title
        return "$title · ${timeLabel(due, it.allDay, now, zone)} · ${countdown(due, it.allDay, now)}"
    }

    /** What a row says when titles are hidden (app lock / privacy setting) */
    fun privateTitle(it: Item): String = when {
        it.type == "action" -> "Action"
        it.isDocument -> "Document"
        it.isList -> "List"
        it.type == "reminder" -> "Reminder"
        it.type == "event" -> "Event"
        else -> "Note"
    }

    /** "Snooze 1 h": the reminder's new time, as the server stores it (ISO with offset) */
    fun snoozeTime(now: Long, minutes: Long = 60, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(now).atZone(zone).plusMinutes(minutes).withSecond(0).withNano(0).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

    /** Lists the pinned-list widget can show (newest first) */
    fun lists(notes: List<JSONObject>): List<Item> =
        notes.filter(::visible).mapNotNull { itemOf(it) }.filter { it.isList }.sortedByDescending { it.createdAt ?: "" }
}
