package com.sanpan003.pocketarchive.wear

import android.content.Context
import java.io.File
import java.util.UUID

/**
 * Recordings on the watch until the phone (or, as a fallback, the server)
 * has them. File name "<capturedAtMillis>_watch-<uuid>.m4a" — the same
 * scheme the phone app uses, so its upload pipeline reads it as is.
 * Accounts: the outbox has a folder per user (the phone's user when the recording
 * was made), so a recording always goes to the account it was made under.
 */
object CaptureQueue {
    data class Meta(val clientId: String, val capturedAt: Long, val userId: String? = null)

    private fun recordingDir(ctx: Context) = File(ctx.filesDir, "recording").apply { mkdirs() }
    private fun queueDir(ctx: Context) = File(ctx.filesDir, "outbox").apply { mkdirs() }

    fun newRecording(ctx: Context): File =
        File(recordingDir(ctx), "${System.currentTimeMillis()}_${Protocol.CLIENT_PREFIX}${UUID.randomUUID()}.m4a")

    /** Finished recording → outbox (in the current user's folder). */
    fun enqueue(ctx: Context, file: File): File {
        val user = WatchTokenStore.userId(ctx)
        val dir = if (user != null) File(queueDir(ctx), user).apply { mkdirs() } else queueDir(ctx)
        val target = File(dir, file.name)
        if (!file.renameTo(target)) return file
        WatchState.refreshQueue(ctx)
        return target
    }

    fun pending(ctx: Context): List<File> {
        val root = queueDir(ctx)
        val dirs = listOf(root) + (root.listFiles { f -> f.isDirectory && f.name.startsWith("u_") }?.toList() ?: emptyList())
        return dirs.flatMap { d -> d.listFiles { f -> f.isFile && f.extension == "m4a" }?.toList() ?: emptyList() }.sortedBy { it.name }
    }

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
        val user = file.parentFile?.name?.takeIf { it.startsWith("u_") }
        return Meta(parts.getOrElse(1) { file.nameWithoutExtension }, parts[0].toLongOrNull() ?: file.lastModified(), user)
    }
}
