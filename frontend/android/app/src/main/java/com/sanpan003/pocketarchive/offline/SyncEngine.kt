package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

/** The NAS, as the sync engine needs it (OkRemote in the app, a fake in tests). Network problems throw IOException. */
interface Remote {
    class Res(val status: Int, val body: String) {
        fun json(): JSONObject? = runCatching { JSONObject(body) }.getOrNull()
    }
    @Throws(IOException::class) fun json(method: String, path: String, body: JSONObject? = null): Res
    /** multipart: [{ name, value } | { name, file: { base64, type, filename } }] */
    @Throws(IOException::class) fun form(method: String, path: String, parts: JSONArray): Res
    /** GET path from byte [from] (Range); start(status, contentType, totalLength?) then bytes until the end */
    @Throws(IOException::class) fun download(path: String, from: Long, start: (Int, String?, Long?) -> Unit, bytes: (ByteArray, Int) -> Unit)
}

/**
 * The offline copy's sync (2.9.0), the same steps in the app and in the background worker:
 *   1. replay — changes made offline, oldest first: ids made offline become the server's in later requests; a text edit
 *      based on an older version comes back 409 → "Edited on another device" (kept on the note until the user picks);
 *      a refused change (4xx) is dropped and listed; a network problem stops (kept for next time).
 *   2. text — notes changed since the last round (paged), deletions, shared items, projects, saved answers (settings…).
 *   3. archive — the admin's Hey Pocket recordings (when switched on).
 *   4. media — plan what to keep (MediaPlan), then thumbnails first, then the rest; resumable; Wi-Fi only if set.
 * Pure logic over OfflineData + Remote + MediaVault (unit tested on the JVM).
 */
class SyncEngine(
    private val data: OfflineData,
    private val remote: Remote,
    private val vault: MediaVault?,
    private val settings: () -> OfflineSettings,
    private val unmetered: () -> Boolean,
    private val isAdmin: () -> Boolean,
    private val events: (String, JSONObject) -> Unit = { _, _ -> },
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    enum class Stop { DONE, NETWORK, SIGNED_OUT, LOCKED, WAITING_WIFI, TIME }

    companion object {
        /** Server answers kept for offline use (the web layer's localApi reads them by path) */
        val KV_SYNC = listOf(
            "/auth/me", "/appearance", "/quick/settings", "/places", "/notify-settings", "/documents/settings", "/actions/settings",
            "/location-reminders", "/errands/active", "/maps/status", "/share/people",
        )
        val KV_ADMIN = listOf("/recordings", "/stats", "/recordings/deleted")
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        fun isNote(o: JSONObject?) = o != null && o.optString("id").startsWith("qn_") && (o.has("createdAt") || o.has("capturedAt"))
    }

    var phase = "idle"
        private set
    var waitingForWifi = false
        private set

    private fun iso(ms: Long) = java.time.Instant.ofEpochMilli(ms).toString()
    private fun stopFor(res: Remote.Res): Stop? = when {
        res.status == 401 -> Stop.SIGNED_OUT
        res.status == 403 && res.json()?.optBoolean("locked") == true -> Stop.LOCKED
        res.status >= 500 || res.status == 429 || res.status == 408 -> Stop.NETWORK
        else -> null
    }

    // ── ids made offline ────────────────────────────────────────────────────
    private fun idmap(): MutableMap<String, String> {
        val o = data.meta("idmap")?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return HashMap()
        val m = HashMap<String, String>()
        o.keys().forEach { m[it] = o.getString(it) }
        return m
    }
    private fun saveIdmap(m: Map<String, String>) {
        // Only ids still mentioned by waiting requests are needed
        val queued = data.queue().joinToString("\n") { it.op.toString() }
        val keep = m.filterKeys { queued.contains(it) }
        data.setMeta("idmap", JSONObject(keep).toString())
    }

    /** Where a note lives in the copy: shared with you (keeps sharedFrom) or yours */
    private fun putNoteKeepingKind(note: JSONObject) {
        val prev = data.getNote(note.getString("id"))
        if (prev?.has("sharedFrom") == true) {
            if (!note.has("sharedFrom")) note.put("sharedFrom", prev.get("sharedFrom"))
            data.putNote("shared", note)
        } else data.putNote(if (note.has("sharedFrom")) "shared" else "own", note)
    }

    // ── 1. replay ───────────────────────────────────────────────────────────
    fun replay(): Stop {
        phase = "replay"
        val ids = idmap()
        val lastRev = HashMap<String, Int>()
        var changed = false
        for (q in data.queue()) {
            val op = q.op
            val method = op.optString("method", "POST")
            val path = IdRewrite.rewrite(op.getString("path"), ids)
            val noteId = op.optString("noteId").takeIf { it.isNotBlank() }?.let { IdRewrite.rewrite(it, ids) }
            val body = op.optJSONObject("body")?.let { IdRewrite.rewrite(it, ids) as JSONObject }
            if (body != null && body.has("baseTextRev") && noteId != null) lastRev[noteId]?.let { body.put("baseTextRev", it) }
            val form = op.optJSONArray("form")?.let { IdRewrite.rewrite(it, ids) as JSONArray }
            val res = try {
                if (form != null) remote.form(method, path, form) else remote.json(method, path, body)
            } catch (e: IOException) { return Stop.NETWORK }
            stopFor(res)?.let { return it }
            changed = true
            val j = res.json()
            data.tx {
                data.removeOp(q.seq)
                when {
                    res.status == 409 && j?.optBoolean("conflict") == true && noteId != null -> {
                        storeConflict(noteId, body, j.optJSONObject("note"))
                        events("conflict", JSONObject().put("id", noteId))
                    }
                    res.status >= 400 -> data.addFailed(JSONObject().put("label", op.optString("label", method)).put("status", res.status)
                        .put("error", j?.optString("error")?.takeIf { it.isNotBlank() } ?: JSONObject.NULL).put("at", iso(now())))
                    else -> {
                        val note = j?.optJSONObject("note")?.takeIf { isNote(it) } ?: j?.takeIf { isNote(it) }
                        val temp = op.optString("tempId").takeIf { it.isNotBlank() }
                        if (op.optBoolean("createsNote") && note != null && temp != null) {
                            ids[temp] = note.getString("id")
                            data.removeNote(temp)
                            moveMedia(temp, note.getString("id"))
                            events("idmap", JSONObject().put("tempId", temp).put("id", note.getString("id")))
                        }
                        if (op.optBoolean("createsProject") && temp != null && j?.optString("id")?.startsWith("pj_") == true) {
                            ids[temp] = j.getString("id")
                            val list = data.getKv("__projects")?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
                            val out = JSONArray()
                            for (i in 0 until list.length()) { val p = list.getJSONObject(i); out.put(if (p.optString("id") == temp) j else p) }
                            data.putKv("__projects", out.toString())
                            events("idmap", JSONObject().put("tempId", temp).put("id", j.getString("id")))
                        }
                        if (note != null) {
                            putNoteKeepingKind(note)
                            lastRev[note.getString("id")] = note.optInt("textRev", 0)
                        }
                    }
                }
                saveIdmap(ids)
            }
        }
        if (changed) events("changed", JSONObject())
        return Stop.DONE
    }

    /** "Edited on another device": the server's version, plus what this phone wanted, until the user picks */
    private fun storeConflict(noteId: String, body: JSONObject?, theirs: JSONObject?) {
        val local = data.getNote(noteId)
        val ops = body?.optJSONArray("ops")
        fun fromOps(op: String, field: String): Any? {
            if (ops == null) return null
            for (i in ops.length() - 1 downTo 0) { val o = ops.optJSONObject(i); if (o?.optString("op") == op) return o.opt(field) }
            return null
        }
        val mine = JSONObject()
            .put("title", body?.opt("title") ?: fromOps("rename", "title") ?: local?.opt("title") ?: JSONObject.NULL)
            .put("content", body?.opt("content") ?: fromOps("editText", "text") ?: local?.opt("content") ?: JSONObject.NULL)
        val server = theirs ?: local ?: return
        val stored = JSONObject(server.toString())
        stored.put("_conflict", JSONObject().put("mine", mine)
            .put("theirs", JSONObject().put("title", server.opt("title") ?: JSONObject.NULL).put("content", server.opt("content") ?: JSONObject.NULL))
            .put("at", iso(now())))
        putNoteKeepingKind(stored)
    }

    /** A preview kept under the offline id's URL (a photo taken offline) moves to the real id's URL */
    private fun moveMedia(temp: String, real: String) {
        for (row in data.allMedia().filter { it.key.contains(temp) }) {
            val moved = row.copy(key = row.key.replace(temp, real), noteId = row.noteId?.replace(temp, real))
            // Files are sealed to their name: write it again under the new one (previews are small)
            vault?.let { v ->
                if (row.state == "have" && v.exists(row.file)) {
                    runCatching {
                        val plain = v.readAll(row.file, row.size)
                        v.writer(moved.file).use { w -> w.write(plain); w.finish() }
                    }
                }
                v.delete(row.file)
            }
            data.removeMedia(row.key)
            data.putMedia(moved)
        }
    }

    // ── 2. text ─────────────────────────────────────────────────────────────
    fun syncText(): Stop {
        if (data.queue().isNotEmpty()) return Stop.DONE // changes go first; next round
        phase = "text"
        val cursor = data.meta("cursor")
        var page = 0
        var first: JSONObject? = null
        val pages = mutableListOf<JSONObject>()
        while (true) {
            val path = "/api/offline/sync?page=$page" + (cursor?.let { "&since=${enc(it)}" } ?: "")
            val res = try { remote.json("GET", path) } catch (e: IOException) { return Stop.NETWORK }
            stopFor(res)?.let { return it }
            if (res.status != 200) return Stop.NETWORK
            val j = res.json() ?: return Stop.NETWORK
            if (page == 0) first = j
            pages += j
            val next = j.opt("nextPage")
            if (next == null || next == JSONObject.NULL) break
            page = j.getInt("nextPage")
        }
        val f = first ?: return Stop.NETWORK
        data.tx {
            val changed = HashSet<String>()
            val media = HashMap<String, MutableList<JSONObject>>()
            for (p in pages) {
                val notes = p.getJSONArray("notes")
                for (i in 0 until notes.length()) {
                    val n = notes.getJSONObject(i)
                    val id = n.getString("id")
                    data.getNote(id)?.optJSONObject("_conflict")?.let { n.put("_conflict", it) } // waits for the user's choice
                    data.putNote("own", n)
                    changed += id
                }
                p.optJSONArray("media")?.let { addMedia(it, media) }
            }
            // Deleted on the server (or never made it there)
            val keep = HashSet<String>().apply { val ids = f.getJSONArray("ids"); for (i in 0 until ids.length()) add(ids.getString(i)) }
            for (id in data.noteIds("own")) if (id !in keep) { data.removeNote(id); removeMediaOfNote(id) }
            // Shared with you: the current list (no longer shared → gone from this phone)
            val shared = f.optJSONArray("shared") ?: JSONArray()
            val sharedIds = HashSet<String>()
            for (i in 0 until shared.length()) {
                val n = shared.getJSONObject(i)
                val id = n.getString("id")
                sharedIds += id
                data.getNote(id)?.optJSONObject("_conflict")?.let { n.put("_conflict", it) }
                data.putNote("shared", n)
                changed += id
            }
            for (id in data.noteIds("shared")) if (id !in sharedIds) { data.removeNote(id); removeMediaOfNote(id) }
            f.optJSONArray("sharedMedia")?.let { addMedia(it, media) }
            // The map for offline use (downloaded only when switched on — MediaPlan)
            val maps = f.optJSONArray("maps") ?: JSONArray()
            val mapKeys = (0 until maps.length()).map { maps.getJSONObject(it).getString("key") }.toSet()
            for (row in data.allMedia().filter { it.kind == "map" && it.key !in mapKeys }) dropMedia(row)
            for (i in 0 until maps.length()) upsertMedia(maps.getJSONObject(i))
            data.putKv("__projects", (f.optJSONArray("projects") ?: JSONArray()).toString())
            data.putKv("__sharedProjects", (f.optJSONArray("sharedProjects") ?: JSONArray()).toString())
            // Media of the notes that changed: new / changed files to fetch, removed ones to drop
            for (id in changed) {
                val list = media[id] ?: emptyList()
                val keys = list.map { it.getString("key") }.toSet()
                for (row in data.allMedia().filter { it.noteId == id && it.key !in keys }) dropMedia(row)
                for (m in list) upsertMedia(m)
            }
        }
        // Saved answers (settings, places, …)
        for (key in KV_SYNC) {
            val r = try { remote.json("GET", "/api$key") } catch (e: IOException) { return Stop.NETWORK }
            stopFor(r)?.let { return it }
            if (r.status == 200) data.putKv(key, r.body)
        }
        data.setMeta("cursor", f.getString("serverTime"))
        data.setMeta("lastSyncAt", iso(now()))
        events("changed", JSONObject())
        return Stop.DONE
    }

    private fun addMedia(list: JSONArray, into: MutableMap<String, MutableList<JSONObject>>) {
        for (i in 0 until list.length()) {
            val m = list.getJSONObject(i)
            val id = m.optString("noteId").takeIf { it.isNotBlank() } ?: continue
            into.getOrPut(id) { mutableListOf() } += m
        }
    }

    private fun upsertMedia(m: JSONObject) {
        val key = m.getString("key")
        val v = m.optString("v").takeIf { it.isNotBlank() && it != "null" }
        val size = m.optLong("size", 0)
        val old = data.media(key)
        // size 0 = not known before the first download (map fonts, sprites)
        if (old != null && old.v == v && (old.size == size || size == 0L) && old.state != "gone") return
        if (old != null) vault?.delete(old.file)
        data.putMedia(MediaRow(key = key, v = v, kind = m.optString("kind", "file"), size = size,
            noteId = m.optString("noteId").takeIf { it.isNotBlank() }, recordingId = m.optString("recordingId").takeIf { it.isNotBlank() }))
    }

    private fun dropMedia(row: MediaRow) { vault?.delete(row.file); data.removeMedia(row.key) }
    private fun removeMediaOfNote(id: String) { for (row in data.allMedia().filter { it.noteId == id }) dropMedia(row) }

    // ── 3. archive (the admin's Hey Pocket recordings) ─────────────────────────
    fun syncArchive(): Stop {
        val s = settings()
        if (!isAdmin() || !s.archive) {
            if (data.recordingIds().isNotEmpty()) data.tx { for (id in data.recordingIds()) removeRecording(id) }
            return Stop.DONE
        }
        phase = "archive"
        val cursor = data.meta("archiveCursor")
        val res = try { remote.json("GET", "/api/offline/archive" + (cursor?.let { "?since=${enc(it)}" } ?: "")) } catch (e: IOException) { return Stop.NETWORK }
        stopFor(res)?.let { return it }
        if (res.status == 403) return Stop.DONE // not the admin (any more)
        if (res.status != 200) return Stop.NETWORK
        val j = res.json() ?: return Stop.NETWORK
        val all = HashSet<String>().apply { val a = j.getJSONArray("ids"); for (i in 0 until a.length()) add(a.getString(i)) }
        val changed = j.getJSONArray("changed")
        for (i in 0 until changed.length()) {
            val id = changed.getString(i)
            val one = try { remote.json("GET", "/api/recordings/${enc(id)}") } catch (e: IOException) { return Stop.NETWORK }
            stopFor(one)?.let { return it }
            if (one.status != 200) continue
            val atts = try { remote.json("GET", "/api/recordings/${enc(id)}/attachments") } catch (e: IOException) { return Stop.NETWORK }
            data.tx {
                data.putKv("/recordings/$id", one.body)
                if (atts.status == 200) data.putKv("/recordings/$id/attachments", atts.body)
                data.putRecording(id, one.body, one.body.lowercase())
            }
        }
        data.tx {
            for (id in data.recordingIds()) if (id !in all) removeRecording(id)
            val media = j.optJSONArray("media") ?: JSONArray()
            for (i in 0 until media.length()) upsertMedia(media.getJSONObject(i))
        }
        for (key in KV_ADMIN) {
            val r = try { remote.json("GET", "/api$key") } catch (e: IOException) { return Stop.NETWORK }
            if (r.status == 200) data.putKv(key, r.body)
        }
        data.setMeta("archiveCursor", j.getString("serverTime"))
        return Stop.DONE
    }

    private fun removeRecording(id: String) {
        data.removeRecording(id)
        data.removeKv("/recordings/$id")
        data.removeKv("/recordings/$id/attachments")
        for (row in data.allMedia().filter { it.recordingId == id }) dropMedia(row)
    }

    // ── 4. media ────────────────────────────────────────────────────────────
    private fun noteInfos(): Map<String, NoteInfo> =
        (data.notes("own") + data.notes("shared")).associate { n ->
            n.getString("id") to NoteInfo(n.optBoolean("pinned"), n.optString("capturedAt").ifBlank { n.optString("createdAt") }.ifBlank { null }, n.optString("projectId").ifBlank { null })
        }

    /** Decide what to keep with the current settings; files no longer kept are removed */
    fun planMedia() {
        val rows = data.allMedia()
        val planned = MediaPlan.plan(rows, noteInfos(), settings(), isAdmin(), data.textBytes(), now())
        val before = rows.associateBy { it.key }
        data.tx {
            for (p in planned) {
                val old = before[p.key]
                if (p.state == "skip" && (old?.state == "have" || old?.state == "partial")) vault?.delete(p.file)
                data.putMedia(if (p.state == "skip") p.copy(done = 0) else p)
            }
        }
    }

    /** { phase, bytesDone, bytesTotal, filesDone, filesTotal, waitingForWifi } */
    fun progress(): JSONObject {
        val rows = data.allMedia().filter { it.state == "want" || it.state == "partial" || it.state == "have" }
        val done = rows.sumOf { if (it.state == "have") it.size else if (it.state == "partial") it.done else 0 }
        return JSONObject().put("phase", phase).put("bytesDone", done).put("bytesTotal", rows.sumOf { it.size })
            .put("filesDone", rows.count { it.state == "have" }).put("filesTotal", rows.size).put("waitingForWifi", waitingForWifi)
    }

    fun downloadMedia(deadline: Long): Stop {
        val v = vault ?: return Stop.DONE
        val s = settings()
        waitingForWifi = false
        val todo = data.allMedia().filter { it.state == "want" || it.state == "partial" }.sortedBy { it.priority }
        for (row in todo) {
            if (now() > deadline) return Stop.TIME
            phase = if (row.kind == "thumb") "thumbs" else "media"
            if (row.kind != "thumb" && s.wifiOnlyMedia && !unmetered()) { waitingForWifi = true; events("progress", progress()); return Stop.WAITING_WIFI }
            val from = if (row.state == "partial") (row.done / MediaVault.CHUNK) * MediaVault.CHUNK else 0L
            var writer: MediaVault.Writer? = null
            var status = 0
            var mime: String? = null
            var written = 0L
            var startChunk = from / MediaVault.CHUNK
            try {
                remote.download(row.key + (row.v?.let { "?v=${enc(it)}" } ?: ""), from, { st, ct, _ ->
                    status = st; mime = ct
                    if (st == 200 && startChunk > 0) startChunk = 0 // the server sent it all: start over
                    if (st == 200 || st == 206) writer = v.writer(row.file, startChunk)
                }) { buf, n -> writer?.write(buf, 0, n); written += n }
            } catch (e: IOException) {
                writer?.let { w -> runCatching { w.close() }; data.putMedia(row.copy(state = "partial", done = w.committedPlain)) }
                return Stop.NETWORK
            }
            val w = writer
            when {
                status == 401 -> { w?.close(); return Stop.SIGNED_OUT }
                status == 403 -> { w?.close(); return Stop.LOCKED }
                status == 404 || status == 410 -> { w?.close(); v.delete(row.file); data.putMedia(row.copy(state = "gone", done = 0)) }
                w == null || status >= 400 -> { w?.close(); return Stop.NETWORK }
                else -> {
                    w.finish(); w.close()
                    val plain = startChunk * MediaVault.CHUNK + written
                    data.putMedia(row.copy(state = "have", size = plain, done = plain, mime = mime ?: row.mime))
                }
            }
            events("progress", progress())
        }
        phase = "done"
        events("progress", progress())
        return Stop.DONE
    }

    /** Everything, in order. Stops at the first problem (the reason tells the caller what to do). */
    fun run(deadline: Long): Stop {
        replay().let { if (it != Stop.DONE) return it }
        syncText().let { if (it != Stop.DONE) return it }
        syncArchive().let { if (it == Stop.SIGNED_OUT || it == Stop.LOCKED || it == Stop.NETWORK) return it }
        planMedia()
        return downloadMedia(deadline)
    }
}
