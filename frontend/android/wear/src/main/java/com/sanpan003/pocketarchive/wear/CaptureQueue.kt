package com.sanpan003.pocketarchive.wear

import android.content.Context
import java.io.File
import java.util.UUID

/**
 * Recordings on the watch until the phone (or, as a fallback, the server)
 * has them. File name "<capturedAtMillis>_watch-<uuid>.m4a" — the same
 * scheme the phone app uses, so its upload pipeline reads it as is.
 */
object CaptureQueue {
    data class Meta(val clientId: String, val capturedAt: Long)

    private fun recordingDir(ctx: Context) = File(ctx.filesDir, "recording").apply { mkdirs() }
    private fun queueDir(ctx: Context) = File(ctx.filesDir, "outbox").apply { mkdirs() }

    fun newRecording(ctx: Context): File =
        File(recordingDir(ctx), "${System.currentTimeMillis()}_${Protocol.CLIENT_PREFIX}${UUID.randomUUID()}.m4a")

    /** Finished recording → outbox. */
    fun enqueue(ctx: Context, file: File): File {
        val target = File(queueDir(ctx), file.name)
        if (!file.renameTo(target)) return file
        WatchState.refreshQueue(ctx)
        return target
    }

    fun pending(ctx: Context): List<File> =
        queueDir(ctx).listFiles { f -> f.isFile && f.extension == "m4a" }?.sortedBy { it.name } ?: emptyList()

    fun count(ctx: Context) = pending(ctx).size

    fun remove(ctx: Context, file: File) {
        file.delete()
        WatchState.refreshQueue(ctx)
    }

    /** Left behind by a killed process (nothing is recording) → outbox. */
    fun recoverOrphans(ctx: Context) {
        if (WatchState.isRecording) return
        recordingDir(ctx).listFiles()?.forEach { f -> if (f.length() > 1_500) enqueue(ctx, f) else f.delete() }
    }

    fun meta(file: File): Meta {
        val parts = file.nameWithoutExtension.split("_", limit = 2)
        return Meta(parts.getOrElse(1) { file.nameWithoutExtension }, parts[0].toLongOrNull() ?: file.lastModified())
    }
}
