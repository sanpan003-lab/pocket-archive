package com.sanpan003.pocketarchive.widget

import android.content.Context
import com.sanpan003.pocketarchive.offline.OfflineData
import com.sanpan003.pocketarchive.offline.OfflineStore
import com.sanpan003.pocketarchive.offline.OfflineWorker
import com.sanpan003.pocketarchive.offline.OkRemote
import com.sanpan003.pocketarchive.offline.Remote
import com.sanpan003.pocketarchive.quick.AppLock
import com.sanpan003.pocketarchive.quick.TokenStore
import com.sanpan003.pocketarchive.quick.WidgetData
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.SecureRandom

/**
 * The widgets' inline actions (2.10.0): tick a list item, add one, mark a reminder Done, Snooze 1 h, a quick text
 * note. With the offline copy (the usual case) the change is made there and queued — it shows at once and is sent in
 * order, also without a connection (the same queue as the app's offline changes). Without it, the NAS directly.
 * Never while the app is locked (the widget opens the app to unlock instead).
 */
object WidgetActions {
    sealed class Outcome {
        object Done : Outcome()
        object NeedsUnlock : Outcome()
        class Failed(val message: String) : Outcome()
    }

    private val random = SecureRandom()
    private fun rand(n: Int) = (1..n).map { "abcdefghijklmnopqrstuvwxyz0123456789"[random.nextInt(36)] }.joinToString("")

    /** Pure: the local change + the request to queue (unit tested). null = nothing to do. */
    fun plan(kind: String, note: JSONObject?, itemId: String?, text: String?, nowMs: Long, newId: () -> String): Pair<JSONObject?, JSONObject>? {
        when (kind) {
            "text" -> {
                val body = text?.trim()?.take(20_000)?.takeIf { it.isNotBlank() } ?: return null
                val id = newId()
                val clientId = "widget-$id"
                val first = body.lineSequence().firstOrNull { it.isNotBlank() }?.take(80) ?: "New note"
                val at = java.time.Instant.ofEpochMilli(nowMs).toString()
                val local = JSONObject().put("id", id).put("clientId", clientId).put("createdAt", at).put("capturedAt", at).put("updatedAt", at)
                    .put("source", "text").put("type", "note").put("title", first).put("content", body).put("status", "saved")
                    .put("offline", JSONObject().put("queuedAt", at).put("pending", JSONArray().put("organize")))
                val op = JSONObject().put("method", "POST").put("path", "/api/quick/text")
                    .put("body", JSONObject().put("body", body).put("aiOrganize", true).put("clientId", clientId))
                    .put("tempId", id).put("createsNote", true).put("label", "New note")
                return local to op
            }
        }
        val n = note ?: return null
        val id = n.getString("id")
        val local = JSONObject(n.toString()).put("offlineEdited", true).put("updatedAt", java.time.Instant.ofEpochMilli(nowMs).toString())
        return when (kind) {
            "toggle" -> {
                val items = local.optJSONArray("items") ?: return null
                var newDone = false
                var found = false
                for (i in 0 until items.length()) {
                    val it = items.getJSONObject(i)
                    if (it.optString("id") == itemId) { newDone = !it.optBoolean("done"); it.put("done", newDone); found = true }
                }
                if (!found) return null
                val all = (0 until items.length()).all { items.getJSONObject(it).optBoolean("done") }
                if (local.optString("type") == "errand" || local.optString("format") == "list") local.put("errandDone", all && items.length() > 0)
                local to JSONObject().put("method", "POST").put("path", "/api/quick/$id/ops").put("noteId", id).put("label", "List change")
                    .put("body", JSONObject().put("ops", JSONArray().put(JSONObject().put("op", "toggleItem").put("itemId", itemId).put("done", newDone))))
            }
            "addItem" -> {
                val t = text?.trim()?.take(300)?.takeIf { it.isNotBlank() } ?: return null
                val iid = "it_w${rand(10)}"
                val items = local.optJSONArray("items") ?: JSONArray().also { local.put("items", it) }
                items.put(JSONObject().put("id", iid).put("text", t).put("done", false).put("pending", true))
                local.put("errandDone", false)
                local to JSONObject().put("method", "POST").put("path", "/api/quick/$id/ops").put("noteId", id).put("label", "Add item")
                    .put("body", JSONObject().put("ops", JSONArray().put(JSONObject().put("op", "addItem").put("itemId", iid).put("text", t))))
            }
            "done" -> {
                local.put("reminderDone", true).put("completedAt", java.time.Instant.ofEpochMilli(nowMs).toString())
                local to JSONObject().put("method", "POST").put("path", "/api/quick/$id/done").put("noteId", id).put("label", "Done")
                    .put("body", JSONObject().put("done", true))
            }
            "snooze" -> {
                val due = WidgetModel.snoozeTime(nowMs)
                local.put("dueDate", due)
                local to JSONObject().put("method", "PUT").put("path", "/api/quick/$id").put("noteId", id).put("label", "Snooze")
                    .put("body", JSONObject().put("dueDate", due))
            }
            else -> null
        }
    }

    /** Run an action (off the main thread). */
    fun run(ctx: Context, kind: String, noteId: String?, itemId: String?, text: String?): Outcome {
        if (AppLock.isLocked(ctx)) return Outcome.NeedsUnlock
        val d: OfflineData? = runCatching { OfflineStore.open(ctx) }.getOrNull()
        if (d != null) {
            val note = noteId?.let { d.getNote(it) }
            val planned = plan(kind, note, itemId, text, System.currentTimeMillis()) { "qn_${System.currentTimeMillis()}_off${rand(6)}" }
                ?: return Outcome.Failed("That’s no longer on this phone — open the app")
            val (local, op) = planned
            d.tx {
                if (local != null) d.putNote(if (local.has("sharedFrom")) "shared" else "own", local)
                d.enqueue(op)
            }
            OfflineStore.emit("changed", JSONObject())
            OfflineStore.emit("status", OfflineStore.status(ctx))
            OfflineWorker.now(ctx, "widget")
            return Outcome.Done
        }
        // No offline copy (switched off): straight to the NAS
        val api = TokenStore.apiBase(ctx) ?: return Outcome.Failed("Open the app to sign in")
        val token = TokenStore.token(ctx) ?: return Outcome.Failed("Open the app to sign in")
        val note = noteId?.let { id -> WidgetData.raw(ctx).firstOrNull { it.optString("id") == id } }
        val (_, op) = plan(kind, note, itemId, text, System.currentTimeMillis()) { "unused" } ?: return Outcome.Failed("Open the app to do that")
        val remote = OkRemote(api, token)
        return try {
            val res: Remote.Res = remote.json(op.getString("method"), op.getString("path"), op.optJSONObject("body"))
            if (res.status in 200..299) { WidgetData.refreshBlocking(ctx); Outcome.Done } else Outcome.Failed(res.json()?.optString("error")?.ifBlank { null } ?: "That didn’t work")
        } catch (e: IOException) {
            Outcome.Failed("No connection — try again later")
        }
    }

}
