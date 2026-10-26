package com.sanpan003.pocketarchive.widget

import android.content.Context
import com.sanpan003.pocketarchive.offline.NasProbe
import com.sanpan003.pocketarchive.offline.OfflineStore
import com.sanpan003.pocketarchive.quick.AppLock
import com.sanpan003.pocketarchive.quick.DocQueue
import com.sanpan003.pocketarchive.quick.PendingStore
import com.sanpan003.pocketarchive.quick.TokenStore
import com.sanpan003.pocketarchive.quick.WidgetData
import org.json.JSONObject

/**
 * Where the widgets get their notes: the offline copy when it's open (it has everything, changes made offline
 * included), else the server's list saved by WidgetData. Nothing while the app is locked.
 */
object WidgetSource {
    fun locked(ctx: Context) = AppLock.isLocked(ctx)
    fun signedOut(ctx: Context) = TokenStore.token(ctx) == null || WidgetData.signedOut(ctx)

    /** Call off the main thread (opening the encrypted copy takes a moment the first time) */
    fun notes(ctx: Context): List<JSONObject> {
        if (locked(ctx) || signedOut(ctx)) return emptyList()
        val d = runCatching { OfflineStore.open(ctx) }.getOrNull()
        return if (d != null) d.notes("own") + d.notes("shared") else WidgetData.raw(ctx)
    }

    /** Changes waiting to be sent: recordings, scans, and the offline copy's queue */
    fun waiting(ctx: Context): Int =
        PendingStore.count(ctx) + DocQueue.count(ctx) + (runCatching { OfflineStore.open(ctx)?.queue()?.size }.getOrNull() ?: 0)

    private fun ago(ms: Long, now: Long): String {
        val m = (now - ms) / 60_000
        return when { m < 1 -> "just now"; m < 60 -> "$m min ago"; m < 24 * 60 -> "${m / 60} h ago"; else -> "${m / (24 * 60)} d ago" }
    }

    /** "Offline · 2 waiting to upload" / "Syncing…" / "Synced 5 min ago" */
    fun status(ctx: Context, now: Long = System.currentTimeMillis()): String {
        if (signedOut(ctx)) return "Signed out — open the app"
        if (locked(ctx)) return "🔒 Locked"
        val waiting = waiting(ctx)
        val last = runCatching { OfflineStore.open(ctx)?.meta("lastSyncAt")?.let { java.time.Instant.parse(it).toEpochMilli() } }.getOrNull()
            ?: WidgetData.fetchedAt(ctx).takeIf { it > 0 }
        val offline = NasProbe.reachable == false || WidgetData.offline(ctx)
        return when {
            offline && waiting > 0 -> "Offline · $waiting waiting to upload"
            offline -> "Offline · last synced ${last?.let { ago(it, now) } ?: "never"}"
            OfflineStore.syncing -> "Syncing…"
            waiting > 0 -> "$waiting waiting to upload"
            last != null -> "Synced ${ago(last, now)}"
            else -> "Tap the bolt to record"
        }
    }
}
