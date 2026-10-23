package com.sanpan003.pocketarchive.quick

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
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

    /**
     * Scanned pages → our server (a note's attachments / pages route), with previews. Returns the server's JSON
     * (the updated note). Throws with a readable message.
     */
    fun uploadPages(ctx: Context, path: String, method: String, part: String, pages: List<Uri>, fields: org.json.JSONObject): org.json.JSONObject {
        val api = TokenStore.apiBase(ctx) ?: throw IllegalStateException("Sign in first")
        val token = TokenStore.token(ctx) ?: throw IllegalStateException("Sign in first")
        val dir = File(ctx.cacheDir, "scan_upload/${System.currentTimeMillis()}").apply { mkdirs() }
        try {
            val body = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM)
            fields.keys().forEach { k -> body.addFormDataPart(k, fields.optString(k)) }
            pages.forEachIndexed { i, uri ->
                val f = File(dir, "page${i + 1}.jpg")
                DocCapture.copyUri(ctx, uri, f)
                if (f.length() > MAX_BYTES) throw IllegalStateException("A page is over 25 MB")
                body.addFormDataPart(part, f.name, f.asRequestBody("image/jpeg".toMediaType()))
                val t = File(dir, "thumb${i + 1}.jpg")
                if (DocCapture.thumb(f, t)) body.addFormDataPart(if (part == "file") "thumb" else "pthumb", t.name, t.asRequestBody("image/jpeg".toMediaType()))
            }
            val req = Request.Builder().url("$api$path").header("Authorization", "Bearer $token").method(method, body.build()).build()
            client.newCall(req).execute().use { r ->
                val text = r.body.string()
                if (!r.isSuccessful) throw IllegalStateException(Uploader.errorMessage(text) ?: "Upload failed (${r.code})")
                return org.json.JSONObject(text)
            }
        } finally {
            dir.deleteRecursively()
        }
    }

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
