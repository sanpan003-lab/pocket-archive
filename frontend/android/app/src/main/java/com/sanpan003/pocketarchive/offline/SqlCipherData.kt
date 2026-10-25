package com.sanpan003.pocketarchive.offline

import android.content.ContentValues
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The offline copy on the phone: one SQLCipher database (AES-256, the whole file encrypted), its key from OfflineKeys
 * (Android Keystore, behind the app lock). Same contract as the in-memory one the sync tests use.
 */
class SqlCipherData private constructor(private val db: SQLiteDatabase) : OfflineData {

    companion object {
        @Volatile private var loaded = false

        fun open(file: File, passphrase: ByteArray): SqlCipherData {
            if (!loaded) { System.loadLibrary("sqlcipher"); loaded = true }
            file.parentFile?.mkdirs()
            val db = SQLiteDatabase.openOrCreateDatabase(file, passphrase, null, null)
            db.execSQL("PRAGMA foreign_keys=OFF")
            db.execSQL("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            db.execSQL("CREATE TABLE IF NOT EXISTS queue (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE IF NOT EXISTS failed (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL)")
            db.execSQL("""CREATE TABLE IF NOT EXISTS media (key TEXT PRIMARY KEY, v TEXT, kind TEXT, size INTEGER, note_id TEXT,
                recording_id TEXT, state TEXT, done INTEGER, mime TEXT, last_used INTEGER, priority INTEGER)""")
            db.execSQL("CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, json TEXT NOT NULL, text TEXT NOT NULL)")
            return SqlCipherData(db)
        }
    }

    fun close() = runCatching { db.close() }

    private fun one(sql: String, vararg args: String): String? =
        db.rawQuery(sql, arrayOf(*args)).use { c -> if (c.moveToFirst()) c.getString(0) else null }

    private fun many(sql: String, vararg args: String): List<String> =
        db.rawQuery(sql, arrayOf(*args)).use { c -> val out = ArrayList<String>(); while (c.moveToNext()) out += c.getString(0); out }

    override fun getNote(id: String) = one("SELECT json FROM notes WHERE id=?", id)?.let { JSONObject(it) }
    override fun notes(kind: String) = many("SELECT json FROM notes WHERE kind=?", kind).map { JSONObject(it) }
    override fun putNote(kind: String, note: JSONObject) {
        db.insertWithOnConflict("notes", null, ContentValues().apply {
            put("id", note.getString("id")); put("kind", kind); put("json", note.toString())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    override fun removeNote(id: String) { db.delete("notes", "id=?", arrayOf(id)) }
    /** Notes waiting for "keep mine / keep theirs / keep both" */
    fun countConflicts(): Int = one("SELECT COUNT(*) FROM notes WHERE instr(json, ?) > 0", "\"_conflict\"")?.toIntOrNull() ?: 0

    override fun noteIds(kind: String) = many("SELECT id FROM notes WHERE kind=?", kind).toHashSet()
    override fun textBytes(): Long =
        (one("SELECT COALESCE(SUM(LENGTH(json)),0) FROM notes")?.toLongOrNull() ?: 0) +
            (one("SELECT COALESCE(SUM(LENGTH(json)),0) FROM kv")?.toLongOrNull() ?: 0) +
            (one("SELECT COALESCE(SUM(LENGTH(json)),0) FROM recordings")?.toLongOrNull() ?: 0)

    override fun getKv(key: String) = one("SELECT json FROM kv WHERE key=?", key)
    override fun putKv(key: String, json: String) {
        db.insertWithOnConflict("kv", null, ContentValues().apply { put("key", key); put("json", json) }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    override fun removeKv(key: String) { db.delete("kv", "key=?", arrayOf(key)) }
    override fun kvKeys(prefix: String) = many("SELECT key FROM kv WHERE substr(key,1,?)=?", prefix.length.toString(), prefix)

    override fun meta(key: String) = one("SELECT value FROM meta WHERE key=?", key)
    override fun setMeta(key: String, value: String?) {
        if (value == null) db.delete("meta", "key=?", arrayOf(key))
        else db.insertWithOnConflict("meta", null, ContentValues().apply { put("key", key); put("value", value) }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    override fun enqueue(op: JSONObject): Long =
        db.insertWithOnConflict("queue", null, ContentValues().apply { put("json", op.toString()) }, SQLiteDatabase.CONFLICT_REPLACE)
    override fun queue(): List<QueuedOp> = db.rawQuery("SELECT seq, json FROM queue ORDER BY seq", arrayOf<String>()).use { c ->
        val out = ArrayList<QueuedOp>(); while (c.moveToNext()) out += QueuedOp(c.getLong(0), JSONObject(c.getString(1))); out
    }
    override fun removeOp(seq: Long) { db.delete("queue", "seq=?", arrayOf(seq.toString())) }
    override fun failed(): JSONArray = JSONArray(many("SELECT json FROM failed ORDER BY id DESC LIMIT 20").map { JSONObject(it) })
    override fun addFailed(entry: JSONObject) {
        db.insertWithOnConflict("failed", null, ContentValues().apply { put("json", entry.toString()) }, SQLiteDatabase.CONFLICT_REPLACE)
        db.execSQL("DELETE FROM failed WHERE id NOT IN (SELECT id FROM failed ORDER BY id DESC LIMIT 50)")
    }

    private fun rowOf(c: android.database.Cursor) = MediaRow(
        key = c.getString(0), v = c.getString(1), kind = c.getString(2) ?: "file", size = c.getLong(3), noteId = c.getString(4),
        recordingId = c.getString(5), state = c.getString(6) ?: "want", done = c.getLong(7), mime = c.getString(8), lastUsed = c.getLong(9), priority = c.getInt(10),
    )
    private val mediaCols = "key, v, kind, size, note_id, recording_id, state, done, mime, last_used, priority"
    override fun media(key: String): MediaRow? = db.rawQuery("SELECT $mediaCols FROM media WHERE key=?", arrayOf(key)).use { c -> if (c.moveToFirst()) rowOf(c) else null }
    override fun allMedia(): List<MediaRow> = db.rawQuery("SELECT $mediaCols FROM media", arrayOf<String>()).use { c ->
        val out = ArrayList<MediaRow>(); while (c.moveToNext()) out += rowOf(c); out
    }
    override fun putMedia(row: MediaRow) {
        db.insertWithOnConflict("media", null, ContentValues().apply {
            put("key", row.key); put("v", row.v); put("kind", row.kind); put("size", row.size); put("note_id", row.noteId)
            put("recording_id", row.recordingId); put("state", row.state); put("done", row.done); put("mime", row.mime)
            put("last_used", row.lastUsed); put("priority", row.priority)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    override fun removeMedia(key: String) { db.delete("media", "key=?", arrayOf(key)) }

    override fun putRecording(id: String, json: String, text: String) {
        db.insertWithOnConflict("recordings", null, ContentValues().apply { put("id", id); put("json", json); put("text", text) }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    override fun removeRecording(id: String) { db.delete("recordings", "id=?", arrayOf(id)) }
    override fun recordingIds() = many("SELECT id FROM recordings").toHashSet()
    override fun searchRecordings(q: String, limit: Int): List<String> {
        val words = q.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }.take(8)
        if (words.isEmpty()) return emptyList()
        val where = words.joinToString(" AND ") { "instr(text, ?) > 0" }
        return db.rawQuery("SELECT id FROM recordings WHERE $where LIMIT $limit", words.toTypedArray()).use { c ->
            val out = ArrayList<String>(); while (c.moveToNext()) out += c.getString(0); out
        }
    }

    override fun <T> tx(block: () -> T): T {
        db.beginTransaction()
        try { val r = block(); db.setTransactionSuccessful(); return r } finally { db.endTransaction() }
    }

    override fun clearAll() {
        tx { for (t in listOf("notes", "kv", "meta", "queue", "failed", "media", "recordings")) db.execSQL("DELETE FROM $t") }
    }
}
