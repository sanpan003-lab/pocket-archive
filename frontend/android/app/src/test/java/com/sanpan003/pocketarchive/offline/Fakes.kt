package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/** In-memory OfflineData (the app uses SQLCipher; same contract) */
class MemoryData : OfflineData {
    val own = LinkedHashMap<String, JSONObject>()
    val shared = LinkedHashMap<String, JSONObject>()
    val kv = HashMap<String, String>()
    val meta = HashMap<String, String>()
    val ops = sortedMapOf<Long, JSONObject>()
    val failedList = JSONArray()
    val mediaRows = LinkedHashMap<String, MediaRow>()
    val recordings = HashMap<String, Pair<String, String>>()
    private var seq = 0L

    override fun getNote(id: String) = (own[id] ?: shared[id])?.let { JSONObject(it.toString()) }
    override fun notes(kind: String) = (if (kind == "shared") shared else own).values.map { JSONObject(it.toString()) }
    override fun putNote(kind: String, note: JSONObject) {
        val id = note.getString("id")
        if (kind == "shared") { own.remove(id); shared[id] = JSONObject(note.toString()) } else { shared.remove(id); own[id] = JSONObject(note.toString()) }
    }
    override fun removeNote(id: String) { own.remove(id); shared.remove(id) }
    override fun noteIds(kind: String) = HashSet((if (kind == "shared") shared else own).keys)
    override fun textBytes() = (own.values + shared.values).sumOf { it.toString().length.toLong() } + kv.values.sumOf { it.length.toLong() }
    override fun getKv(key: String) = kv[key]
    override fun putKv(key: String, json: String) { kv[key] = json }
    override fun removeKv(key: String) { kv.remove(key) }
    override fun kvKeys(prefix: String) = kv.keys.filter { it.startsWith(prefix) }
    override fun meta(key: String) = meta[key]
    override fun setMeta(key: String, value: String?) { if (value == null) meta.remove(key) else meta[key] = value }
    override fun enqueue(op: JSONObject): Long { seq++; ops[seq] = JSONObject(op.toString()); return seq }
    override fun queue() = ops.map { (k, v) -> QueuedOp(k, JSONObject(v.toString())) }
    override fun removeOp(seq: Long) { ops.remove(seq) }
    override fun failed() = failedList
    override fun addFailed(entry: JSONObject) { failedList.put(entry) }
    override fun media(key: String) = mediaRows[key]
    override fun allMedia() = mediaRows.values.toList()
    override fun putMedia(row: MediaRow) { mediaRows[row.key] = row }
    override fun removeMedia(key: String) { mediaRows.remove(key) }
    override fun putRecording(id: String, json: String, text: String) { recordings[id] = json to text }
    override fun removeRecording(id: String) { recordings.remove(id) }
    override fun recordingIds() = HashSet(recordings.keys)
    override fun searchRecordings(q: String, limit: Int): List<String> {
        val words = q.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        return recordings.filter { (_, v) -> words.all { v.second.contains(it) } }.keys.take(limit)
    }
    override fun <T> tx(block: () -> T): T = block()
    override fun clearAll() { own.clear(); shared.clear(); kv.clear(); meta.clear(); ops.clear(); mediaRows.clear(); recordings.clear() }
}

/**
 * A small NAS for the tests, following the real server's rules: notes with updatedAt + textRev, 409 on an old
 * baseTextRev, clientId de-duplication, /api/offline/sync paging + ids, media with Range.
 */
class FakeServer : Remote {
    val notes = LinkedHashMap<String, JSONObject>()
    val shared = mutableListOf<JSONObject>()
    val files = HashMap<String, ByteArray>()   // media key → bytes
    val mediaOf = HashMap<String, MutableList<JSONObject>>()  // noteId → media entries
    val recordings = HashMap<String, String>()
    val mapEntries = mutableListOf<JSONObject>()
    var admin = false
    var down = false
    var failAfterBytes = -1L       // cut a download after this many bytes (IOException)
    var ignoreRange = false
    var status5xx = false
    val log = mutableListOf<String>()
    private var clock = 1_000_000_000_000L
    private var counter = 0
    private fun now() = java.time.Instant.ofEpochMilli(clock).toString().also { clock += 1000 }

    fun note(id: String, title: String, content: String = "", extra: JSONObject.() -> Unit = {}): JSONObject {
        val n = JSONObject().put("id", id).put("title", title).put("content", content).put("createdAt", now()).put("textRev", 0)
        n.extra(); n.put("updatedAt", now()); notes[id] = n
        return n
    }
    fun edit(id: String, block: JSONObject.() -> Unit) { val n = notes.getValue(id); n.block(); n.put("updatedAt", now()) }

    private fun ok(o: Any) = Remote.Res(200, o.toString())
    private fun err(status: Int, msg: String, extra: JSONObject.() -> Unit = {}) = Remote.Res(status, JSONObject().put("error", msg).apply(extra).toString())

    override fun json(method: String, path: String, body: JSONObject?): Remote.Res {
        if (down) throw IOException("no route to host")
        if (status5xx) return err(503, "busy")
        log += "$method $path${body?.let { " $it" } ?: ""}"
        val p = path.substringBefore('?')
        val qs = path.substringAfter('?', "").split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        Regex("^/api/quick/(qn_[\\w-]+)$").find(p)?.let { m ->
            val n = notes[m.groupValues[1]] ?: return err(404, "Quick note not found")
            if (method == "GET") return ok(n)
            if (method == "PUT") {
                val b = body ?: JSONObject()
                if (b.has("baseTextRev") && b.getInt("baseTextRev") != n.optInt("textRev")) {
                    val changes = (b.has("title") && b.getString("title") != n.optString("title")) || (b.has("content") && b.getString("content") != n.optString("content"))
                    if (changes) return Remote.Res(409, JSONObject().put("conflict", true).put("error", "Edited on another device").put("note", n).toString())
                }
                val textChanged = (b.has("title") && b.getString("title") != n.optString("title")) || (b.has("content") && b.getString("content") != n.optString("content"))
                for (k in listOf("title", "content", "pinned")) if (b.has(k)) n.put(k, b.get(k))
                if (textChanged) n.put("textRev", n.optInt("textRev") + 1)
                n.put("updatedAt", now())
                return ok(n)
            }
        }
        Regex("^/api/quick/(qn_[\\w-]+)/undo$").find(p)?.let { m ->
            val n = notes[m.groupValues[1]] ?: return err(404, "Quick note not found")
            n.put("undone", true).put("updatedAt", now()); return ok(n)
        }
        if (p == "/api/quick/text" && method == "POST") {
            val b = body ?: JSONObject()
            notes.values.firstOrNull { it.optString("clientId") == b.optString("clientId") && b.has("clientId") }?.let { return ok(JSONObject().put("note", it)) }
            val id = "qn_${clock}_srv${++counter}"
            val n = note(id, b.optString("title", "New"), b.optString("body")) { put("clientId", b.optString("clientId")) }
            return ok(JSONObject().put("note", n))
        }
        if (p == "/api/forbidden") return err(403, "Only the owner can do that")
        if (p == "/api/offline/sync") {
            val since = qs["since"]
            val page = qs["page"]?.toInt() ?: 0
            val changed = notes.values.filter { since == null || it.getString("updatedAt") > since }.sortedBy { it.getString("id") }
            val limit = 2
            val slice = changed.drop(page * limit).take(limit)
            val out = JSONObject().put("serverTime", now()).put("full", since == null).put("page", page)
                .put("nextPage", if ((page + 1) * limit < changed.size) page + 1 else JSONObject.NULL)
                .put("notes", JSONArray(slice))
                .put("media", JSONArray(slice.flatMap { mediaOf[it.getString("id")] ?: emptyList() }))
            if (page == 0) {
                out.put("ids", JSONArray(notes.keys.toList())).put("shared", JSONArray(shared)).put("sharedMedia", JSONArray())
                    .put("projects", JSONArray()).put("sharedProjects", JSONArray()).put("maps", JSONArray(mapEntries))
            }
            return ok(out)
        }
        if (p == "/api/offline/archive") {
            if (!admin) return err(403, "The archive is the admin’s")
            return ok(JSONObject().put("serverTime", now()).put("ids", JSONArray(recordings.keys.toList())).put("changed", JSONArray(recordings.keys.toList()))
                .put("media", JSONArray(recordings.keys.map { JSONObject().put("key", "/api/audio/$it.mp3").put("size", files["/api/audio/$it.mp3"]?.size ?: 0).put("kind", "recording").put("recordingId", it) })))
        }
        Regex("^/api/recordings/([^/]+)(/attachments)?$").find(p)?.let { m ->
            val id = java.net.URLDecoder.decode(m.groupValues[1], "UTF-8")
            val r = recordings[id] ?: return err(404, "nope")
            return if (m.groupValues[2].isNotEmpty()) ok(JSONArray()) else ok(JSONObject(r))
        }
        if (p.startsWith("/api/") && method == "GET") return ok(JSONObject().put("path", p))
        return err(400, "unknown $method $p")
    }

    override fun form(method: String, path: String, parts: JSONArray): Remote.Res {
        if (down) throw IOException("no route to host")
        log += "FORM $method $path"
        return ok(JSONObject())
    }

    override fun download(path: String, from: Long, start: (Int, String?, Long?) -> Unit, bytes: (ByteArray, Int) -> Unit) {
        if (down) throw IOException("no route to host")
        val key = path.substringBefore('?')
        val data = files[key] ?: run { start(404, null, null); return }
        val begin = if (ignoreRange) 0L else from
        start(if (begin > 0) 206 else 200, "image/jpeg", data.size.toLong())
        var sent = 0L
        var i = begin.toInt()
        while (i < data.size) {
            val n = minOf(8192, data.size - i)
            if (failAfterBytes >= 0 && sent + n > failAfterBytes) { failAfterBytes = -1; throw IOException("connection reset") }
            bytes(data.copyOfRange(i, i + n), n)
            sent += n; i += n
        }
    }
}
