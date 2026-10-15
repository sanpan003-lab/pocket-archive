package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/** Talking to the phone app over the Wearable Data Layer. */
object PhoneLink {
    private const val TAG = "PhoneLink"
    private const val ACK_TIMEOUT_MS = 90_000L

    /** The phone running Pocket Archive, if reachable right now (nearby/Bluetooth first). */
    suspend fun phone(ctx: Context): Node? = runCatching {
        Wearable.getCapabilityClient(ctx)
            .getCapability(Protocol.CAP_PHONE, CapabilityClient.FILTER_REACHABLE)
            .await()
            .nodes
            .minByOrNull { if (it.isNearby) 0 else 1 }
    }.onFailure { Log.w(TAG, "Capability lookup failed: ${it.message}") }.getOrNull()

    /**
     * Stream a recording to the phone (ChannelClient) and wait until the phone
     * confirms it has the whole file. False = keep it queued and try later.
     */
    suspend fun sendCapture(ctx: Context, node: Node, file: File): Boolean {
        val meta = CaptureQueue.meta(file)
        val ack = CompletableDeferred<Boolean>()
        val listener = MessageClient.OnMessageReceivedListener { event ->
            if (event.path == Protocol.MSG_CAPTURE_ACK && String(event.data) == meta.clientId) ack.complete(true)
        }
        val messages = Wearable.getMessageClient(ctx)
        val channels = Wearable.getChannelClient(ctx)
        return try {
            messages.addListener(listener).await()
            val channel = channels.openChannel(node.id, "${Protocol.CHANNEL_CAPTURE}/${meta.clientId}/${meta.capturedAt}").await()
            try {
                channels.sendFile(channel, Uri.fromFile(file)).await()
                withTimeoutOrNull(ACK_TIMEOUT_MS) { ack.await() } == true
            } finally {
                runCatching { channels.close(channel).await() }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Send to phone failed: ${e.message}")
            false
        } finally {
            runCatching { messages.removeListener(listener).await() }
        }
    }

    suspend fun message(ctx: Context, path: String, data: ByteArray = ByteArray(0)): Boolean {
        val node = phone(ctx) ?: return false
        return runCatching { Wearable.getMessageClient(ctx).sendMessage(node.id, path, data).await(); true }
            .getOrDefault(false)
    }

    /** Checklist change → phone (persisted by the Data Layer until the phone gets it). */
    fun putToggle(ctx: Context, errandId: String, itemId: String, done: Boolean) {
        val req = PutDataMapRequest.create("${Protocol.DATA_TOGGLE}/$errandId/$itemId").apply {
            dataMap.putBoolean("done", done)
            dataMap.putLong("at", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        Wearable.getDataClient(ctx).putDataItem(req)
            .addOnFailureListener { Log.w(TAG, "Toggle not stored: ${it.message}") }
    }

    /** "Done" on the watch's arrival notification. */
    fun putDone(ctx: Context, errandId: String) {
        val req = PutDataMapRequest.create("${Protocol.DATA_DONE}/$errandId").apply {
            dataMap.putLong("at", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        Wearable.getDataClient(ctx).putDataItem(req)
    }

    /** Latest notes/errands the phone stored, e.g. when the app opens. */
    suspend fun loadState(ctx: Context) {
        runCatching {
            val items = Wearable.getDataClient(ctx).dataItems.await()
            try {
                items.firstOrNull { it.uri.path == Protocol.DATA_STATE }?.let { WatchListenerService.applyState(ctx, it) }
            } finally {
                items.release()
            }
        }
    }
}
