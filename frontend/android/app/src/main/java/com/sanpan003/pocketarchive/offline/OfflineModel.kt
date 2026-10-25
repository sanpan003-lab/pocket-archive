package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Settings → Offline & storage (per phone). mode: everything | thumbs | text | recent */
data class OfflineSettings(
    val mode: String = "everything",
    val wifiOnlyMedia: Boolean = true,
    val limitBytes: Long = 0,
    val archive: Boolean = true,
    val maps: Boolean = false,
    val keepIds: List<String> = emptyList(),
    /** false after "Delete offline data" until Sync now */
    val enabled: Boolean = true,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode).put("wifiOnlyMedia", wifiOnlyMedia).put("limitBytes", limitBytes).put("archive", archive)
        .put("maps", maps).put("keepIds", JSONArray(keepIds)).put("enabled", enabled)

    companion object {
        val MODES = setOf("everything", "thumbs", "text", "recent")
        fun fromJson(o: JSONObject?): OfflineSettings {
            if (o == null) return OfflineSettings()
            val keep = o.optJSONArray("keepIds")
            return OfflineSettings(
                mode = o.optString("mode", "everything").takeIf { it in MODES } ?: "everything",
                wifiOnlyMedia = o.optBoolean("wifiOnlyMedia", true),
                limitBytes = o.optLong("limitBytes", 0).coerceAtLeast(0),
                archive = o.optBoolean("archive", true),
                maps = o.optBoolean("maps", false),
                keepIds = if (keep == null) emptyList() else (0 until keep.length()).map { keep.optString(it) }.filter { it.isNotBlank() }.take(500),
                enabled = o.optBoolean("enabled", true),
            )
        }
    }
}

/**
 * One media file of the offline copy. key = the request path the screens use (/api/quick/<id>/media …).
 * state: want (to download) | partial (resumable) | have | skip (not kept with these settings) | gone (404)
 */
data class MediaRow(
    val key: String,
    val v: String?,
    val kind: String,           // photo | scan | file | audio | thumb | recording | map
    val size: Long,
    val noteId: String? = null,
    val recordingId: String? = null,
    val state: String = "want",
    val done: Long = 0,
    val mime: String? = null,
    val lastUsed: Long = 0,
    val priority: Int = 0,
) {
    /** Name of the encrypted file (no note ids or titles on disk) */
    val file: String get() = fileName(key)

    companion object {
        fun fileName(key: String): String {
            val d = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            return d.joinToString("") { "%02x".format(it) }.take(40)
        }
    }
}

/** What the media planner needs to know about a note */
data class NoteInfo(val pinned: Boolean, val capturedAt: String?, val projectId: String?)

/**
 * Which media files to keep with the chosen settings, in which order (pure, unit tested):
 * thumbnails first, then what's pinned / kept / recent, then the rest; recordings last. The storage limit is for
 * media — notes (text) are always kept. Over the limit → skip (and its file is removed).
 */
object MediaPlan {
    private const val DAY = 86_400_000L

    fun wanted(row: MediaRow, note: NoteInfo?, s: OfflineSettings, isAdmin: Boolean, now: Long): Boolean {
        if (row.state == "gone") return false
        if (row.kind == "map") return s.maps
        if (row.kind == "recording" || row.recordingId != null) return isAdmin && s.archive && s.mode == "everything"
        val kept = row.noteId != null && (row.noteId in s.keepIds || (note?.projectId != null && note.projectId in s.keepIds))
        if (kept) return true
        return when (s.mode) {
            "everything" -> true
            "thumbs" -> row.kind == "thumb"
            "text" -> false
            "recent" -> row.kind == "thumb" || note?.pinned == true || recent(note?.capturedAt, now)
            else -> true
        }
    }

    fun priority(row: MediaRow, note: NoteInfo?, s: OfflineSettings, now: Long): Int = when {
        row.kind == "thumb" -> 0
        row.noteId != null && row.noteId in s.keepIds -> 1
        note?.pinned == true -> 2
        recent(note?.capturedAt, now) -> 3
        row.kind == "photo" || row.kind == "scan" -> 4
        row.kind == "file" -> 5
        row.kind == "audio" -> 6
        row.kind == "map" -> 8
        else -> 7 // recordings
    }

    private fun recent(iso: String?, now: Long): Boolean {
        val t = iso?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return false
        return now - t <= 30 * DAY
    }

    /**
     * New states + priorities for every row. textBytes counts against the limit first (text is never dropped).
     * Within the budget, higher priority (lower number) and newer notes win.
     */
    fun plan(rows: List<MediaRow>, notes: Map<String, NoteInfo>, s: OfflineSettings, isAdmin: Boolean, textBytes: Long, now: Long): List<MediaRow> {
        val scored = rows.map { r ->
            val n = r.noteId?.let { notes[it] }
            Triple(r, wanted(r, n, s, isAdmin, now), priority(r, n, s, now))
        }
        var budget = if (s.limitBytes > 0) s.limitBytes - textBytes else Long.MAX_VALUE
        val order = scored.filter { it.second }.sortedWith(compareBy<Triple<MediaRow, Boolean, Int>> { it.third }
            .thenByDescending { it.first.noteId?.let { id -> notes[id]?.capturedAt } ?: "" })
        val fits = HashSet<String>()
        for ((r, _, _) in order) {
            if (r.size <= budget) { fits += r.key; budget -= r.size }
        }
        return scored.map { (r, _, p) ->
            val keep = r.key in fits
            val state = when {
                r.state == "gone" -> "gone"
                !keep -> "skip"
                r.state == "have" || r.state == "partial" -> r.state
                else -> "want"
            }
            r.copy(state = state, priority = p)
        }
    }
}

/** Ids made offline (qn_<ms>_off<6>, pj_<ms>_off<6>) → the server's, in a queued request (paths, bodies, form fields) */
object IdRewrite {
    fun rewrite(text: String, idmap: Map<String, String>): String =
        idmap.entries.fold(text) { acc, (temp, real) -> if (acc.contains(temp)) acc.replace(temp, real) else acc }

    fun rewrite(value: Any?, idmap: Map<String, String>): Any? = when (value) {
        is String -> rewrite(value, idmap)
        is JSONObject -> JSONObject().also { out ->
            val it = value.keys()
            while (it.hasNext()) {
                val k = it.next()
                out.put(k, if (k == "base64") value.get(k) else rewrite(value.get(k), idmap))
            }
        }
        is JSONArray -> JSONArray().also { out -> for (i in 0 until value.length()) out.put(rewrite(value.get(i), idmap)) }
        else -> value
    }
}
