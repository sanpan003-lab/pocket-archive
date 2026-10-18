package com.sanpan003.pocketarchive.quick

import android.content.Context
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Recordings live in app-private storage until the server confirms them:
 * "quick_recording" while being recorded / first sent, "quick_pending" once
 * they're waiting for a retry (that's what the app shows as "queued").
 * File name = "<capturedAtMillis>_<clientId>.m4a"; the clientId lets the
 * server de-duplicate retried uploads.
 */
object PendingStore {
    data class Meta(val clientId: String, val capturedAtIso: String)

    fun dir(ctx: Context): File = File(ctx.filesDir, "quick_pending").apply { mkdirs() }

    private fun recordingDir(ctx: Context): File = File(ctx.filesDir, "quick_recording").apply { mkdirs() }

    fun newFile(ctx: Context): File =
        File(recordingDir(ctx), "${System.currentTimeMillis()}_${UUID.randomUUID()}.m4a")

    /** Move a recording into the retry queue; returns its new location. */
    fun moveToPending(ctx: Context, file: File): File {
        if (file.parentFile == dir(ctx)) return file
        val target = File(dir(ctx), file.name)
        return if (file.renameTo(target)) target else file
    }

    /** Recordings left behind by a killed process (nothing is recording now) → retry queue. */
    fun recoverOrphans(ctx: Context) {
        if (RecorderState.recording) return
        recordingDir(ctx).listFiles { f -> f.isFile && f.extension == "m4a" }?.forEach { f ->
            if (f.length() > 1_500) UploadWorker.enqueue(ctx, f) else f.delete()
        }
    }

    fun meta(file: File): Meta {
        val parts = file.nameWithoutExtension.split("_", limit = 2)
        val millis = parts.getOrNull(0)?.toLongOrNull() ?: file.lastModified()
        return Meta(parts.getOrNull(1) ?: file.nameWithoutExtension, Instant.ofEpochMilli(millis).toString())
    }

    fun pending(ctx: Context): List<File> =
        dir(ctx).listFiles { f -> f.isFile && f.extension == "m4a" }?.sortedBy { it.name } ?: emptyList()

    fun count(ctx: Context): Int = pending(ctx).size

    // ── Accounts: another user's queued recordings wait here until they sign in again ──
    private fun heldDir(ctx: Context, userId: String): File =
        File(ctx.filesDir, "quick_held/${userId.filter { it.isLetterOrDigit() || it == '_' }}").apply { mkdirs() }

    /** Signed out / another user signed in: park this user's queue (never uploaded with someone else's token). */
    fun hold(ctx: Context, userId: String) {
        val files = pending(ctx).toMutableList()
        if (!RecorderState.recording) recordingDir(ctx).listFiles { f -> f.isFile && f.extension == "m4a" && f.length() > 1_500 }?.let { files += it }
        for (f in files) f.renameTo(File(heldDir(ctx, userId), f.name))
    }

    /** One recording (e.g. from the watch) that belongs to someone who isn't signed in on this phone. */
    fun holdFile(ctx: Context, userId: String, file: File) { file.renameTo(File(heldDir(ctx, userId), file.name)) }

    /** That user signed in again: their parked recordings go back into the upload queue. */
    fun release(ctx: Context, userId: String): Int {
        val files = heldDir(ctx, userId).listFiles { f -> f.isFile && f.extension == "m4a" } ?: return 0
        for (f in files) f.renameTo(File(dir(ctx), f.name))
        return files.size
    }

    fun heldCount(ctx: Context): Int =
        File(ctx.filesDir, "quick_held").listFiles()?.sumOf { d -> d.listFiles()?.size ?: 0 } ?: 0
}
