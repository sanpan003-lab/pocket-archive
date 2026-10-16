package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Phone → watch: results, the notes/errands state, the device token, arrival
 * lists. Also re-sends queued recordings when the phone comes back.
 */
class WatchListenerService : WearableListenerService() {

    companion object {
        fun applyState(ctx: Context, item: DataItem) {
            val map = DataMapItem.fromDataItem(item).dataMap
            WatchData.apply(ctx, map.getString("recent"), map.getString("errands"), map.getLong("updatedAt"))
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        val text = String(event.data, Charsets.UTF_8)
        when (event.path) {
            Protocol.MSG_RESULT -> runCatching { ResultPresenter.show(this, JSONObject(text)) }
            Protocol.MSG_TOKEN -> runCatching {
                val o = JSONObject(text)
                WatchTokenStore.set(this, o.optString("token"), o.optString("apiBase"))
            }
            Protocol.MSG_TOKEN_CLEAR -> WatchTokenStore.set(this, null, null)
            Protocol.MSG_ARRIVAL -> runCatching { showArrival(JSONObject(text)) }
            // MSG_CAPTURE_ACK is handled by the live listener in PhoneLink.sendCapture
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            val path = event.dataItem.uri.path ?: continue
            when {
                path == Protocol.DATA_STATE && event.type == DataEvent.TYPE_CHANGED -> applyState(this, event.dataItem)
                path == Protocol.DATA_REC_SETTINGS && event.type == DataEvent.TYPE_CHANGED ->
                    WatchPrefs.fromPhone(this, DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json"))
                // The phone deletes a checklist change once it reached the server
                path.startsWith("${Protocol.DATA_TOGGLE}/") && event.type == DataEvent.TYPE_DELETED -> {
                    val parts = path.removePrefix("${Protocol.DATA_TOGGLE}/").split('/')
                    if (parts.size == 2) WatchData.confirmed(this, parts[0], parts[1])
                }
            }
        }
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        // Phone reachable again → send anything that waited
        if (info.name == Protocol.CAP_PHONE && info.nodes.isNotEmpty() && CaptureQueue.count(this) > 0) {
            SendWorker.sendNow(this)
        }
    }

    /** The watch's own version of the phone's arrival reminder: "Open list" opens the checklist here. */
    private fun showArrival(o: JSONObject) {
        val id = o.optString("id").takeIf { it.isNotBlank() } ?: return
        val place = o.optString("placeName").takeIf { it.isNotBlank() && it != "null" } ?: o.optString("title")
        val items = o.optJSONArray("items")
        val open = (0 until (items?.length() ?: 0)).mapNotNull { items?.optJSONObject(it) }.filter { !it.optBoolean("done") }
        val reminder = o.optString("kind") == "reminder"
        val headline = o.optString("headline").takeIf { it.isNotBlank() && it != "null" }
        val title = when {
            reminder -> "${headline ?: "📍 Reminder"} — ${o.optString("title")}"
            open.isEmpty() -> "🛒 You're at $place"
            open.size == 1 -> "🛒 You're at $place — 1 item"
            else -> "🛒 You're at $place — ${open.size} items"
        }
        val text = o.optString("text").takeIf { it.isNotBlank() && it != "null" && it != o.optString("title") }
        val list = if (reminder) listOfNotNull(text, open.joinToString("\n") { "☐ ${it.optString("text")}" }.ifBlank { null }).joinToString("\n\n")
            else open.joinToString("\n") { "☐ ${it.optString("text")}" }
        val nid = 3000 + (id.hashCode() and 0xFFFF)
        val openList = WatchNotifications.openApp(this, nid) { putExtra(MainActivity.EXTRA_ERRAND, id) }
        val done = android.app.PendingIntent.getBroadcast(
            this, nid,
            Intent(this, ArrivalActionReceiver::class.java).putExtra(ArrivalActionReceiver.EXTRA_ID, id),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        WatchNotifications.ensureChannels(this)
        WatchNotifications.notify(this, nid,
            NotificationCompat.Builder(this, WatchNotifications.CH_ARRIVAL)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setColor(WatchNotifications.GREEN)
                .setContentTitle(title)
                .setContentText(if (reminder) (text ?: o.optString("title")) else open.joinToString(", ") { it.optString("text") })
                .setStyle(NotificationCompat.BigTextStyle().bigText(list))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openList)
                .addAction(0, "Open list", openList)
                .addAction(0, "Done", done),
        )
    }
}
