package com.sanpan003.pocketarchive.wear

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.File

/**
 * Same safety net as the phone: a recording without speech (or shorter than 2 s) is kept for 30 seconds
 * with "Ignored accidental recording · Restore"; Restore sends it like any other recording.
 */
object IgnoredRecordings {
    private const val KEEP_MS = 30_000L
    private const val ID = 5
    private val main = Handler(Looper.getMainLooper())

    private fun dir(ctx: Context) = File(ctx.filesDir, "ignored").apply { mkdirs() }

    fun keep(ctx: Context, recording: File, reason: String) {
        val app = ctx.applicationContext
        val kept = File(dir(app), recording.name)
        if (!recording.renameTo(kept)) { recording.copyTo(kept, overwrite = true); recording.delete() }
        val restore = PendingIntent.getBroadcast(app, 9, Intent(app, RestoreReceiver::class.java).putExtra("file", kept.name),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        WatchNotifications.ensureChannels(app)
        WatchNotifications.notify(app, ID, NotificationCompat.Builder(app, WatchNotifications.CH_RESULT)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(WatchNotifications.AMBER)
            .setContentTitle("Ignored accidental recording")
            .setContentText(reason)
            .setTimeoutAfter(KEEP_MS)
            .setAutoCancel(true)
            .setContentIntent(restore)
            .addAction(0, "Restore", restore))
        main.postDelayed({ if (kept.exists()) kept.delete(); NotificationManagerCompat.from(app).cancel(ID) }, KEEP_MS)
    }

    fun restore(ctx: Context, name: String) {
        NotificationManagerCompat.from(ctx).cancel(ID)
        val f = File(dir(ctx), File(name).name)
        if (!f.exists()) return
        val back = CaptureQueue.newRecording(ctx)
        if (!f.renameTo(back)) { f.copyTo(back, overwrite = true); f.delete() }
        CaptureQueue.enqueue(ctx, back)
        WatchState.set(Phase.Sending)
        SendWorker.sendNow(ctx)
    }

    fun cleanup(ctx: Context) {
        val cutoff = System.currentTimeMillis() - KEEP_MS * 2
        dir(ctx).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    class RestoreReceiver : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) { intent.getStringExtra("file")?.let { restore(ctx, it) } }
    }
}
