package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sanpan003.pocketarchive.R
import java.io.File

/**
 * "Discard" (volume key) asks nothing: the recording is set aside, a short
 * "Discarded" notification offers Undo for 10 s, then the audio is deleted.
 * Undo uploads it as if it had been saved.
 */
object DiscardStore {
    const val UNDO_MS = 10_000L
    private const val ID_DISCARDED = 1003
    private val main = Handler(Looper.getMainLooper())

    private fun dir(ctx: Context) = File(ctx.filesDir, "quick_discarded").apply { mkdirs() }

    fun discard(ctx: Context, recording: File) {
        val app = ctx.applicationContext
        val kept = File(dir(app), recording.name)
        if (!recording.renameTo(kept)) { recording.copyTo(kept, overwrite = true); recording.delete() }
        notify(app, kept)
        main.postDelayed({
            if (kept.exists()) kept.delete()
            NotificationManagerCompat.from(app).cancel(ID_DISCARDED)
        }, UNDO_MS)
    }

    /** Undo: back into the upload queue */
    fun restore(ctx: Context, name: String): Boolean {
        val f = File(dir(ctx), File(name).name)
        NotificationManagerCompat.from(ctx).cancel(ID_DISCARDED)
        if (!f.exists()) return false
        UploadWorker.enqueue(ctx, PendingStore.moveToPending(ctx, f))
        WidgetState.uploading(ctx)
        return true
    }

    /** Left over from a process that died within the 10 s */
    fun cleanup(ctx: Context) {
        val cutoff = System.currentTimeMillis() - UNDO_MS * 2
        dir(ctx).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    private fun notify(ctx: Context, kept: File) {
        val undo = PendingIntent.getBroadcast(
            ctx, 7,
            Intent(ctx, DiscardUndoReceiver::class.java).putExtra(DiscardUndoReceiver.EXTRA_FILE, kept.name),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, Notifications.CH_RESULT_SILENT)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Discarded")
            .setContentText("The recording wasn't saved")
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setTimeoutAfter(UNDO_MS)
            .setAutoCancel(true)
            .addAction(0, "Undo", undo)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_DISCARDED, n) } catch (_: SecurityException) { /* notifications off */ }
    }
}

class DiscardUndoReceiver : BroadcastReceiver() {
    companion object { const val EXTRA_FILE = "file" }

    override fun onReceive(ctx: Context, intent: Intent) {
        intent.getStringExtra(EXTRA_FILE)?.let { DiscardStore.restore(ctx, it) }
    }
}
