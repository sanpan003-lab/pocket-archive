package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Phone side of the Galaxy Watch link (Wearable Data Layer). Paths and
 * payloads match wear/…/Protocol.kt. All calls block: background threads only
 * (workers, the recorder's I/O thread, or [async]).
 */
object WearBridge {
    private const val TAG = "WearBridge"

    const val CAP_PHONE = "pocket_archive_phone"
    const val CAP_WATCH = "pocket_archive_watch"
    const val CHANNEL_CAPTURE = "/pa/capture"
    const val MSG_CAPTURE_ACK = "/pa/capture-ack"
    const val MSG_RESULT = "/pa/result"
    const val MSG_TOKEN = "/pa/token"
    const val MSG_TOKEN_CLEAR = "/pa/token-clear"
    const val MSG_TOKEN_REQUEST = "/pa/token-request"
    const val MSG_SYNC_REQUEST = "/pa/sync-request"
    const val MSG_ARRIVAL = "/pa/arrival"
    const val MSG_DECIDE = "/pa/decide"
    const val DATA_STATE = "/pa/state"
    const val DATA_TOGGLE = "/pa/toggle"
    const val DATA_DONE = "/pa/done"
    const val CLIENT_PREFIX = "watch-"

    private const val PREFS = "wear_bridge"
    private val io = Executors.newSingleThreadExecutor()
    private val http by lazy {
        OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    }

    fun async(block: () -> Unit) = io.execute { runCatching(block).onFailure { Log.w(TAG, "Watch link: ${it.message}") } }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Watches with the Pocket Archive app. reachable = connected right now. */
    fun watches(ctx: Context, reachable: Boolean = true): Set<Node> = try {
        val nodes = Tasks.await(
            Wearable.getCapabilityClient(ctx).getCapability(CAP_WATCH, if (reachable) CapabilityClient.FILTER_REACHABLE else CapabilityClient.FILTER_ALL),
            10, TimeUnit.SECONDS,
        ).nodes
        if (!reachable) prefs(ctx).edit().putBoolean("watchApp", nodes.isNotEmpty()).apply()
        nodes
    } catch (e: Exception) {
        emptySet() // no Wear OS / Galaxy Wearable on this phone
    }

    /** Cached: is the watch app installed on a paired watch? (cheap; for main-thread decisions) */
    fun watchAppKnown(ctx: Context) = prefs(ctx).getBoolean("watchApp", false)

    fun setWatchAppKnown(ctx: Context, known: Boolean) = prefs(ctx).edit().putBoolean("watchApp", known).apply()

    private fun send(ctx: Context, nodes: Collection<Node>, path: String, data: ByteArray): Boolean {
        var ok = false
        for (n in nodes) {
            ok = runCatching { Tasks.await(Wearable.getMessageClient(ctx).sendMessage(n.id, path, data), 10, TimeUnit.SECONDS); true }
                .getOrDefault(false) || ok
        }
        return ok
    }

    fun send(ctx: Context, nodeId: String, path: String, data: ByteArray = ByteArray(0)) = runCatching {
        Tasks.await(Wearable.getMessageClient(ctx).sendMessage(nodeId, path, data), 10, TimeUnit.SECONDS); true
    }.getOrDefault(false)

    /** Server confirmation for a watch capture → shown on the wrist. True if a watch got it. */
    fun sendResult(ctx: Context, clientId: String?, confirmation: JSONObject): Boolean {
        val payload = JSONObject(confirmation.toString()).put("clientId", clientId)
        return send(ctx, watches(ctx), MSG_RESULT, payload.toString().toByteArray())
    }

    /** The phone's device token for the watch's direct-upload fallback (same token → revoking the phone stops the watch too). */
    fun sendToken(ctx: Context, nodeId: String? = null) {
        val token = TokenStore.token(ctx)
        val apiBase = TokenStore.apiBase(ctx)
        val nodes = nodeId?.let { id -> watches(ctx).filter { it.id == id }.ifEmpty { null } } ?: watches(ctx)
        if (nodes.isEmpty()) return
        if (token == null || apiBase == null) {
            send(ctx, nodes, MSG_TOKEN_CLEAR, ByteArray(0))
        } else {
            send(ctx, nodes, MSG_TOKEN, JSONObject().put("token", token).put("apiBase", apiBase).put("userId", TokenStore.userId(ctx)).toString().toByteArray())
        }
    }

    fun clearToken(ctx: Context) = async { send(ctx, watches(ctx), MSG_TOKEN_CLEAR, ByteArray(0)) }

    /** Arrival list → the watch shows its own notification ("Open list" opens the watch checklist). */
    fun sendArrival(ctx: Context, errand: ErrandStore.Errand, placeName: String?): Boolean {
        val payload = JSONObject()
            .put("id", errand.id)
            .put("title", errand.title)
            .put("placeName", placeName ?: errand.placeName)
            .put("items", JSONArray().apply { errand.items.forEach { put(JSONObject().put("text", it.text).put("done", it.done)) } })
            .put("kind", errand.kind)
            .put("when", errand.whenAt)
            .put("text", errand.text)
            .put("headline", if (errand.isReminder) ArrivalNotifier.reminderHeadline(errand, placeName ?: errand.placeName) else null)
        return send(ctx, watches(ctx), MSG_ARRIVAL, payload.toString().toByteArray())
    }

    /**
     * Recent notes (with AI summaries) + open errands → DataItem "/pa/state".
     * The Data Layer delivers it when the watch is next connected.
     */
    fun syncState(ctx: Context) {
        if (watches(ctx, reachable = false).isEmpty()) return // no watch app installed
        val apiBase = TokenStore.apiBase(ctx) ?: return
        val token = TokenStore.token(ctx) ?: return
        val recent = get("$apiBase/api/quick/recent?limit=5&summary=1", token) ?: return
        val errands = get("$apiBase/api/errands/open", token)?.let { JSONObject(it).optJSONArray("errands")?.toString() } ?: return
        val req = PutDataMapRequest.create(DATA_STATE).apply {
            dataMap.putString("recent", recent)
            dataMap.putString("errands", errands)
            dataMap.putLong("updatedAt", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching { Tasks.await(Wearable.getDataClient(ctx).putDataItem(req), 10, TimeUnit.SECONDS) }
            .onFailure { Log.w(TAG, "Watch state not stored: ${it.message}") }
    }

    private fun get(url: String, token: String): String? = runCatching {
        http.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute().use { r ->
            if (r.isSuccessful) r.body.string() else null
        }
    }.getOrNull()
}
