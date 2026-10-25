package com.sanpan003.pocketarchive.offline

import android.net.ConnectivityManager
import android.net.Network
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.sanpan003.pocketarchive.quick.TokenStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Offline" for the web layer (src/lib/offline/native.js has the contract): the copy, the queue, sync, settings.
 * Everything runs off the main thread. Calls fail with "locked" while the app lock is closed.
 */
@CapacitorPlugin(name = "Offline")
class OfflinePlugin : Plugin() {

    override fun load() {
        val ctx = context.applicationContext
        OfflineStore.onEvent { event, payload -> notifyListeners(event, JSObject.fromJSONObject(payload)) }
        NasProbe.onChange { OfflineStore.emit("status", OfflineStore.status(ctx)); if (it) OfflineWorker.now(ctx, "online") }
        OfflineWorker.schedule(ctx)
        // The connection changed: check the NAS again (and sync when it's back)
        runCatching {
            ctx.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { NasProbe.forget(); bg { NasProbe.check(TokenStore.apiBase(ctx), 0) } }
                override fun onLost(network: Network) { NasProbe.markUnreachable() }
            })
        }
        bg { NasProbe.check(TokenStore.apiBase(ctx), 0) }
    }

    private fun bg(block: () -> Unit) = Thread { runCatching(block) }.start()

    /** Run on a worker thread; reject "locked" when the copy can't be opened */
    private fun withData(call: PluginCall, block: (SqlCipherData) -> JSObject) = bg {
        val d = OfflineStore.open(context) ?: return@bg call.reject("The offline copy is locked or switched off", "locked")
        try { call.resolve(block(d)) } catch (e: Exception) { call.reject(e.message ?: "Offline copy error") }
    }

    private fun jsArray(list: List<JSONObject>): JSArray = JSArray(JSONArray(list).toString())

    @PluginMethod
    fun status(call: PluginCall) = bg { call.resolve(JSObject.fromJSONObject(OfflineStore.status(context))) }

    @PluginMethod
    fun getAll(call: PluginCall) = withData(call) { d ->
        val items: JSArray = when (call.getString("kind")) {
            "shared" -> jsArray(d.notes("shared"))
            "projects" -> JSArray(d.getKv("__projects") ?: "[]")
            "sharedProjects" -> JSArray(d.getKv("__sharedProjects") ?: "[]")
            else -> jsArray(d.notes("own") + waitingCaptures())
        }
        JSObject().put("items", items)
    }

    /** Recordings and scans made without a connection (native queues): shown in the Inbox until they're uploaded */
    private fun waitingCaptures(): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        com.sanpan003.pocketarchive.quick.PendingStore.pending(context).forEachIndexed { i, f ->
            val m = com.sanpan003.pocketarchive.quick.PendingStore.meta(f)
            out += placeholder("qn_${java.time.Instant.parse(m.capturedAtIso).toEpochMilli()}_pendv$i", m.capturedAtIso, "Voice note", "voice", "organize")
        }
        com.sanpan003.pocketarchive.quick.DocQueue.pending(context).forEachIndexed { i, dir ->
            val at = java.time.Instant.ofEpochMilli(dir.lastModified()).toString()
            out += placeholder("qn_${dir.lastModified()}_pends$i", at, "Scan or photo", "scan", "read")
        }
        return out
    }

    private fun placeholder(id: String, at: String, title: String, source: String, work: String) = JSONObject()
        .put("id", id).put("createdAt", at).put("capturedAt", at).put("updatedAt", at).put("type", "note").put("source", source)
        .put("title", "$title — waiting to upload").put("content", "Saved on this phone. It uploads and is sorted when you’re back online.")
        .put("status", "saved").put("localOnly", true)
        .put("offline", JSONObject().put("queuedAt", at).put("pending", JSONArray().put(work)))

    @PluginMethod
    fun get(call: PluginCall) = withData(call) { d -> JSObject().put("item", d.getNote(call.getString("id") ?: "") ?: JSObject.NULL) }

    @PluginMethod
    fun getKv(call: PluginCall) = withData(call) { d ->
        val raw = d.getKv(call.getString("key") ?: "")
        JSObject().put("value", raw?.let { runCatching { if (it.trimStart().startsWith("[")) JSONArray(it) else JSONObject(it) }.getOrNull() } ?: JSObject.NULL)
    }

    @PluginMethod
    fun putKv(call: PluginCall) = withData(call) { d ->
        val key = call.getString("key") ?: throw IllegalArgumentException("key?")
        val value = call.data.opt("value") ?: JSONObject.NULL
        d.putKv(key, value.toString())
        JSObject()
    }

    @PluginMethod
    fun putNotes(call: PluginCall) = withData(call) { d ->
        val kind = if (call.getString("kind") == "shared") "shared" else "own"
        val notes = call.getArray("notes") ?: JSArray()
        d.tx { for (i in 0 until notes.length()) d.putNote(kind, notes.getJSONObject(i)) }
        JSObject()
    }

    @PluginMethod
    fun removeNote(call: PluginCall) = withData(call) { d -> d.removeNote(call.getString("id") ?: ""); JSObject() }

    @PluginMethod
    fun enqueue(call: PluginCall) = withData(call) { d ->
        val op = call.getObject("op") ?: throw IllegalArgumentException("op?")
        val seq = d.enqueue(op)
        OfflineStore.emit("status", OfflineStore.status(context))
        OfflineWorker.now(context, "queued")
        JSObject().put("seq", seq)
    }

    @PluginMethod
    fun queue(call: PluginCall) = withData(call) { d ->
        JSObject().put("ops", jsArray(d.queue().map { JSONObject(it.op.toString()).apply { remove("form"); put("seq", it.seq) } })).put("failed", JSArray(d.failed().toString()))
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        val reason = call.getString("reason") ?: "user"
        if (reason == "network-error") NasProbe.forget()
        bg { OfflineStore.runSync(context, reason, System.currentTimeMillis() + 8 * 60_000L) }
        call.resolve()
    }

    @PluginMethod
    fun putMedia(call: PluginCall) = withData(call) { _ ->
        val bytes = Base64.decode(call.getString("base64") ?: "", Base64.DEFAULT)
        OfflineStore.putMedia(context, call.getString("key") ?: throw IllegalArgumentException("key?"), bytes, call.getString("type") ?: "application/octet-stream")
        JSObject()
    }

    @PluginMethod
    fun setSettings(call: PluginCall) = bg {
        OfflineStore.setSettings(context, OfflineSettings.fromJson(call.data))
        OfflineWorker.now(context, "settings")
        call.resolve(JSObject.fromJSONObject(OfflineStore.status(context)))
    }

    @PluginMethod
    fun freeUpSpace(call: PluginCall) = bg { OfflineStore.freeUpSpace(context); call.resolve() }

    @PluginMethod
    fun wipe(call: PluginCall) = bg { OfflineStore.wipe(context, call.getString("reason") ?: "user"); call.resolve() }

    @PluginMethod
    fun resolveConflict(call: PluginCall) = withData(call) { d ->
        val id = call.getString("id") ?: ""
        d.getNote(id)?.let { n ->
            if (n.has("_conflict")) { n.remove("_conflict"); d.putNote(if (n.has("sharedFrom")) "shared" else "own", n) }
        }
        OfflineStore.emit("status", OfflineStore.status(context))
        OfflineStore.emit("changed", JSONObject().put("ids", JSONArray().put(id)))
        JSObject()
    }

    /** The admin's recordings matching every word (meta from the saved /recordings list) */
    @PluginMethod
    fun searchArchive(call: PluginCall) = withData(call) { d ->
        val ids = d.searchRecordings(call.getString("q") ?: "", 30).toSet()
        val list = d.getKv("/recordings")?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
        val out = (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("id") in ids }.map { JSONObject(it.toString()).put("snippet", "") }
        JSObject().put("items", jsArray(out))
    }
}
