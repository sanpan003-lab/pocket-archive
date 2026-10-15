package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/**
 * Smart append buttons on result notifications and the widget:
 * Undo (reverse an automatic append) · Yes / New note (answer "Add to …?").
 * The server call runs in ErrandWorker (retries until online).
 */
class QuickActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_UNDO = "com.sanpan003.pocketarchive.capture.UNDO"
        const val ACTION_YES = "com.sanpan003.pocketarchive.capture.YES"
        const val ACTION_NEW = "com.sanpan003.pocketarchive.capture.NEW"
        const val EXTRA_CAPTURE = "captureId"

        fun intent(ctx: Context, action: String, captureId: String): PendingIntent = PendingIntent.getBroadcast(
            ctx,
            (action + captureId).hashCode(),
            Intent(ctx, QuickActionReceiver::class.java).setAction(action).putExtra(EXTRA_CAPTURE, captureId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_CAPTURE) ?: return
        NotificationManagerCompat.from(ctx).cancel(Notifications.ID_RESULT)
        WidgetState.clear(ctx)
        when (intent.action) {
            ACTION_UNDO -> ErrandWorker.captureAction(ctx, id, "undo")
            ACTION_YES -> ErrandWorker.captureAction(ctx, id, "yes")
            ACTION_NEW -> ErrandWorker.captureAction(ctx, id, "new")
        }
    }
}
