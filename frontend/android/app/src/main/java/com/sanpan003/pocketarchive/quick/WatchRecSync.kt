package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The watch's own "while recording" settings (stored on the watch). The phone
 * keeps a copy for Settings → Recording & shortcuts → Galaxy Watch and sends
 * edits as DataItem /pa/rec-settings; edits made on the watch come back as
 * /pa/rec-settings-watch. Newest updatedAt wins.
 */
object WatchRecSync {
    const val DATA_FROM_PHONE = "/pa/rec-settings"
    const val DATA_FROM_WATCH = "/pa/rec-settings-watch"
    private const val PREFS = "watch_rec_settings"

    private val DEFAULTS = JSONObject()
        .put("quickRecordWhileRecording", "stop") // tile / complication / Quick Record while recording: stop | ignore | new
        .put("silenceSec", 4)
        .put("maxMinutes", 2)
        .put("feedback", "vibrate")               // vibrate | none
        .put("countdown", false)
        .put("guardSec", 3)
        .put("noSpeechDiscard", true)
        .put("noSpeechSec", 4)
        .put("minLengthDiscard", true)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(ctx: Context): JSONObject {
        val stored = prefs(ctx).getString("json", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val out = JSONObject(DEFAULTS.toString())
        stored?.keys()?.forEach { out.put(it, stored.get(it)) }
        return out
    }

    private fun clean(o: JSONObject): JSONObject {
        val out = JSONObject()
        o.optString("quickRecordWhileRecording").takeIf { it in setOf("stop", "ignore", "new") }?.let { out.put("quickRecordWhileRecording", it) }
        if (o.has("silenceSec")) o.optInt("silenceSec").takeIf { it in setOf(0, 3, 4, 6, 10) }?.let { out.put("silenceSec", it) }
        if (o.has("maxMinutes")) o.optInt("maxMinutes").takeIf { it in setOf(1, 2, 5, 10) }?.let { out.put("maxMinutes", it) }
        o.optString("feedback").takeIf { it in setOf("vibrate", "none") }?.let { out.put("feedback", it) }
        if (o.has("countdown")) out.put("countdown", o.optBoolean("countdown"))
        if (o.has("guardSec")) out.put("guardSec", o.optInt("guardSec").coerceIn(2, 5))
        if (o.has("noSpeechDiscard")) out.put("noSpeechDiscard", o.optBoolean("noSpeechDiscard"))
        if (o.has("noSpeechSec")) o.optInt("noSpeechSec").takeIf { it in setOf(3, 4, 6) }?.let { out.put("noSpeechSec", it) }
        if (o.has("minLengthDiscard")) out.put("minLengthDiscard", o.optBoolean("minLengthDiscard"))
        return out
    }

    /** Edited on the phone → store + send to the watch */
    fun update(ctx: Context, patch: JSONObject): JSONObject {
        val next = get(ctx)
        val c = clean(patch)
        c.keys().forEach { next.put(it, c.get(it)) }
        next.put("updatedAt", System.currentTimeMillis())
        prefs(ctx).edit().putString("json", next.toString()).apply()
        WearBridge.async { push(ctx, next) }
        return next
    }

    /** Edited on the watch → keep the phone's copy in step */
    fun fromWatch(ctx: Context, json: String) {
        val incoming = runCatching { JSONObject(json) }.getOrNull() ?: return
        if (incoming.optLong("updatedAt") <= get(ctx).optLong("updatedAt")) return
        val next = get(ctx)
        val c = clean(incoming)
        c.keys().forEach { next.put(it, c.get(it)) }
        next.put("updatedAt", incoming.optLong("updatedAt"))
        prefs(ctx).edit().putString("json", next.toString()).apply()
    }

    private fun push(ctx: Context, settings: JSONObject) {
        if (WearBridge.watches(ctx, reachable = false).isEmpty()) return
        val req = PutDataMapRequest.create(DATA_FROM_PHONE).apply {
            dataMap.putString("json", settings.toString())
            dataMap.putLong("updatedAt", settings.optLong("updatedAt"))
        }.asPutDataRequest().setUrgent()
        runCatching { Tasks.await(Wearable.getDataClient(ctx).putDataItem(req), 10, TimeUnit.SECONDS) }
            .onFailure { Log.w("WatchRecSync", "Watch settings not sent: ${it.message}") }
    }
}
