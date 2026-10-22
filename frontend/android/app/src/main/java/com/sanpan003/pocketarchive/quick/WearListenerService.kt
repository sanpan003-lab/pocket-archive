package com.sanpan003.pocketarchive.quick

import android.net.Uri
import android.util.Log
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.io.File

/**
 * Watch → phone. Recordings arrive over a channel and go into the EXISTING
 * upload pipeline (PendingStore + UploadWorker: same endpoint, device token,
 * WorkManager retries); the result goes back to the watch from ResultNotifier.
 * Also: checklist changes, "Done" from the watch, token and sync requests.
 */
class WearListenerService : WearableListenerService() {

    companion object {
        private const val TAG = "WearListener"

        /** "/pa/capture/<clientId>/<capturedAtMillis>[/<userId>]" → "watch_incoming[/<userId>]/<capturedAt>_<clientId>.m4a" */
        fun incomingFile(ctx: android.content.Context, path: String): File? {
            val parts = path.removePrefix("${WearBridge.CHANNEL_CAPTURE}/").split('/')
            if (parts.size != 2 && parts.size != 3) return null
            val clientId = parts[0]
            val capturedAt = parts[1].toLongOrNull() ?: return null
            if (!clientId.startsWith(WearBridge.CLIENT_PREFIX) || !clientId.matches(Regex("[A-Za-z0-9-]{8,80}"))) return null
            val user = parts.getOrNull(2)?.takeIf { it.matches(Regex("u_[a-f0-9]{6,32}")) }
            val dir = File(ctx.filesDir, if (user != null) "watch_incoming/$user" else "watch_incoming").apply { mkdirs() }
            return File(dir, "${capturedAt}_$clientId.m4a")
        }

        /** A complete watch recording → the phone's upload pipeline (retry queue + WorkManager). Returns its clientId. */
        fun handOff(ctx: android.content.Context, file: File): String {
            // Made under another account than the one signed in on the phone: keep it for that user
            val owner = file.parentFile?.name?.takeIf { it.startsWith("u_") }
            if (owner != null && owner != TokenStore.userId(ctx)) {
                PendingStore.holdFile(ctx, owner, file)
                return file.nameWithoutExtension.substringAfter('_')
            }
            UploadWorker.enqueue(ctx, file)
            QuickRecorderPlugin.notifyPending(ctx)
            return file.nameWithoutExtension.substringAfter('_')
        }
    }

    // ── Audio from the watch ───────────────────────────────────────────────

    override fun onChannelOpened(channel: ChannelClient.Channel) {
        if (!channel.path.startsWith("${WearBridge.CHANNEL_CAPTURE}/")) return
        val file = incomingFile(this, channel.path) ?: return
        Wearable.getChannelClient(this).receiveFile(channel, Uri.fromFile(file), false)
    }

    override fun onInputClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
        if (!channel.path.startsWith("${WearBridge.CHANNEL_CAPTURE}/")) return
        val file = incomingFile(this, channel.path) ?: return
        if (closeReason != ChannelClient.ChannelCallback.CLOSE_REASON_NORMAL || !file.exists() || file.length() < 1_000) {
            Log.w(TAG, "Watch recording incomplete (reason $closeReason); the watch will resend")
            file.delete()
            return
        }
        val clientId = handOff(this, file)
        WearBridge.async { WearBridge.send(this, channel.nodeId, WearBridge.MSG_CAPTURE_ACK, clientId.toByteArray()) }
    }

    // ── Messages ───────────────────────────────────────────────────────────

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearBridge.MSG_TOKEN_REQUEST -> WearBridge.async { WearBridge.sendToken(this, event.sourceNodeId) }
            WearBridge.MSG_SYNC_REQUEST -> ErrandWorker.syncNow(this)
            // The watch's recording starts → Settings → Accidental recordings
            WearBridge.MSG_REC_LOG -> runCatching { RecordingLog.fromWatch(this, org.json.JSONObject(String(event.data))) }
            // Watch without network: the phone fetches its update and sends it over
            WatchUpdateRelay.MSG_UPDATE_REQUEST -> UpdateWorker.relayToWatch(this)
            // Watch result screen: Undo, or Yes / New note for "Add to …?"
            WearBridge.MSG_DECIDE -> runCatching {
                val o = org.json.JSONObject(String(event.data))
                val choice = o.optString("choice")
                if (choice in setOf("undo", "yes", "new")) ErrandWorker.captureAction(this, o.getString("captureId"), choice)
            }
        }
    }

    // ── Checklist changes / "Done" from the watch ──────────────────────────

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val item = event.dataItem
            val path = item.uri.path ?: continue
            val map = DataMapItem.fromDataItem(item).dataMap
            when {
                path.startsWith("${WearBridge.DATA_TOGGLE}/") -> {
                    val parts = path.removePrefix("${WearBridge.DATA_TOGGLE}/").split('/')
                    if (parts.size == 2) ErrandWorker.toggleItem(this, parts[0], parts[1], map.getBoolean("done"), item.uri.toString())
                }
                path == WatchRecSync.DATA_FROM_WATCH -> WatchRecSync.fromWatch(this, map.getString("json") ?: "")
                path == WatchVersion.DATA_WATCH_INFO -> WatchVersion.set(this, map.getLong("versionCode"), map.getString("versionName"))
                path.startsWith("${WearBridge.DATA_DONE}/") -> {
                    val id = path.removePrefix("${WearBridge.DATA_DONE}/")
                    ErrandStore.markLocallyDone(this, id)
                    ArrivalNotifier.cancel(this, id)
                    ErrandWorker.markDone(this, id, item.uri.toString())
                }
            }
        }
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        if (info.name != WearBridge.CAP_WATCH) return
        if (info.nodes.isNotEmpty()) {
            WearBridge.setWatchAppKnown(this, true)
            WearBridge.async { WearBridge.sendToken(this) }
            ErrandWorker.syncNow(this)
        }
    }
}
