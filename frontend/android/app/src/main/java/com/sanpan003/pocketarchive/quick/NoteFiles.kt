package com.sanpan003.pocketarchive.quick

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Attachments on notes, the native parts:
 * - a scanned document (Google ML Kit Document Scanner, on-device) → PDF + a small first-page preview
 * - opening an attachment in the right app: download it (device token) to the cache, then ACTION_VIEW
 */
object NoteFiles {
    const val MAX_BYTES = 25L * 1024 * 1024
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()
    }

    /** ML Kit result → { pdf (base64), thumb (base64 JPEG), pages, name } */
    fun scanResult(ctx: Context, pdfUri: Uri, pageCount: Int, firstPage: Uri?): Map<String, Any> {
        val bytes = ctx.contentResolver.openInputStream(pdfUri)?.use { it.readBytes() } ?: throw IllegalStateException("The scan couldn't be read")
        if (bytes.size > MAX_BYTES) throw IllegalStateException("The scan is over 25 MB — try fewer pages")
        val stamp = SimpleDateFormat("yyyy-MM-dd HH.mm", Locale.US).format(Date())
        val out = mutableMapOf<String, Any>(
            "pdf" to Base64.encodeToString(bytes, Base64.NO_WRAP),
            "pages" to pageCount.coerceAtLeast(1),
            "name" to "Scan $stamp.pdf",
        )
        firstPage?.let { thumb(ctx, it) }?.let { out["thumb"] = Base64.encodeToString(it, Base64.NO_WRAP) }
        return out
    }

    /** A ≤ 480 px JPEG preview of a page image */
    private fun thumb(ctx: Context, uri: Uri, max: Int = 480): ByteArray? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= max || bounds.outHeight / (sample * 2) >= max) sample *= 2
        val bmp = ctx.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val scale = minOf(1f, max.toFloat() / maxOf(bmp.width, bmp.height))
        val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
        ByteArrayOutputStream().use { s -> scaled.compress(Bitmap.CompressFormat.JPEG, 80, s); s.toByteArray() }
    }.getOrNull()

    /**
     * Download an attachment (only from our own server, with the device token) and open it in the app
     * Android picks for its type. Throws with a readable message.
     */
    fun open(ctx: Context, url: String, name: String, mime: String) {
        val api = TokenStore.apiBase(ctx) ?: throw IllegalStateException("Sign in first")
        val token = TokenStore.token(ctx) ?: throw IllegalStateException("Sign in first")
        val target = Uri.parse(url)
        if (target.host != Uri.parse(api).host || target.scheme != Uri.parse(api).scheme) throw IllegalStateException("Not a Pocket Archive file")
        val dir = File(ctx.cacheDir, "attachments").apply { mkdirs() }
        // Opened files are kept for a day (re-opening is instant), then cleaned up
        val dayAgo = System.currentTimeMillis() - 86_400_000L
        dir.listFiles()?.filter { it.lastModified() < dayAgo }?.forEach { it.deleteRecursively() }
        val safe = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").take(120).ifBlank { "attachment" }
        val folder = File(dir, Integer.toHexString(url.hashCode())).apply { mkdirs() }
        val file = File(folder, safe)
        if (!file.exists() || file.length() == 0L) {
            client.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (!r.isSuccessful) throw IllegalStateException(if (r.code == 404) "That file is gone" else "Couldn't download it (${r.code})")
                val part = File(folder, "$safe.part")
                part.outputStream().use { out -> r.body.byteStream().copyTo(out) }
                if (!part.renameTo(file)) { part.copyTo(file, overwrite = true); part.delete() }
            }
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime.ifBlank { "*/*" })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(view)
        } catch (_: ActivityNotFoundException) {
            val ext = safe.substringAfterLast('.', "").uppercase()
            throw IllegalStateException(if (ext.isNotEmpty()) "No app on this phone opens $ext files" else "No app on this phone opens this file")
        }
    }
}
