package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject

/** A queued change: the request as the app made it (method, path, body / form), oldest first */
data class QueuedOp(val seq: Long, val op: JSONObject)

/**
 * The offline copy's storage (SqlCipherData in the app, an in-memory one in tests).
 * kinds: "own" (your notes) | "shared" (shared with you, with sharedFrom)
 */
interface OfflineData {
    fun getNote(id: String): JSONObject?
    fun notes(kind: String): List<JSONObject>
    fun putNote(kind: String, note: JSONObject)
    fun removeNote(id: String)
    fun noteIds(kind: String): Set<String>
    /** Approximate bytes of text (notes + saved answers) */
    fun textBytes(): Long

    fun getKv(key: String): String?
    fun putKv(key: String, json: String)
    fun removeKv(key: String)
    fun kvKeys(prefix: String): List<String>

    fun meta(key: String): String?
    fun setMeta(key: String, value: String?)

    fun enqueue(op: JSONObject): Long
    fun queue(): List<QueuedOp>
    fun removeOp(seq: Long)
    fun failed(): JSONArray
    fun addFailed(entry: JSONObject)

    fun media(key: String): MediaRow?
    fun allMedia(): List<MediaRow>
    fun putMedia(row: MediaRow)
    fun removeMedia(key: String)

    fun putRecording(id: String, json: String, text: String)
    fun removeRecording(id: String)
    fun recordingIds(): Set<String>
    /** Recording ids whose searchable text contains every word of q */
    fun searchRecordings(q: String, limit: Int): List<String>

    fun <T> tx(block: () -> T): T
    fun clearAll()
}
