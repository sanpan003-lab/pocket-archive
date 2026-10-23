package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.sanpan003.pocketarchive.MainActivity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Scan & Camera notes (2.6.0): the ML Kit Document Scanner (on-device, auto-crop, multi-page) or the system camera,
 * then a NEW note uploaded to POST /api/quick/document, read as a document on the server.
 * Captures wait in a per-user queue (files/doc_queue/<userId>/<clientId>/) and go up with WorkManager whenever
 * there's a network — only ever with the token of the user who captured them (another user signed in → they wait).
 */
object DocCapture {
    private const val TAG = "DocCapture"
    const val MAX_SIDE = 2400

    fun scannerOptions(pageLimit: Int): GmsDocumentScannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(pageLimit.coerceIn(1, 50))
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()

    /** Page images of a scan result (JPEG uris in ML Kit's cache) */
    fun pagesOf(data: Intent?): List<Uri> =
        GmsDocumentScanningResult.fromActivityResultIntent(data)?.pages?.map { it.imageUri } ?: emptyList()

    /** Where the system camera writes the photo (cache, shared through our FileProvider) */
    fun cameraTarget(ctx: Context): Pair<File, Uri> {
        val dir = File(ctx.cacheDir, "doc_capture").apply { mkdirs() }
        dir.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000L }?.forEach { it.delete() }
        val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        return f to FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
    }

    /** A camera photo: upright (EXIF rotation applied), ≤ 2400 px, JPEG 88 % */
    fun normalizePhoto(src: File, dst: File) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= MAX_SIDE || bounds.outHeight / (sample * 2) >= MAX_SIDE) sample *= 2
        var bmp = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: throw IOException("Unreadable photo")
        val rotation = when (runCatching { ExifInterface(src.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(bmp.width, bmp.height))
        if (rotation != 0f || scale < 1f) {
            val m = Matrix().apply { if (scale < 1f) postScale(scale, scale); if (rotation != 0f) postRotate(rotation) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        dst.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
    }

    /** A ≤ 480 px JPEG preview */
    fun thumb(src: File, dst: File): Boolean = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 480 || bounds.outHeight / (sample * 2) >= 480) sample *= 2
        val bmp = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
        val s = minOf(1f, 480f / maxOf(bmp.width, bmp.height))
        val out = if (s < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt().coerceAtLeast(1), (bmp.height * s).toInt().coerceAtLeast(1), true) else bmp
        ByteArrayOutputStream().use { b -> out.compress(Bitmap.CompressFormat.JPEG, 80, b); dst.writeBytes(b.toByteArray()) }
        true
    }.getOrElse { Log.w(TAG, "No preview", it); false }

    fun copyUri(ctx: Context, uri: Uri, dst: File) {
        ctx.contentResolver.openInputStream(uri)?.use { input -> dst.outputStream().use { input.copyTo(it) } } ?: throw IOException("Can't read the page")
    }
}

/** The per-user queue of scans / camera photos waiting to become notes */
object DocQueue {
    private const val TAG = "DocQueue"
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).readTimeout(150, TimeUnit.SECONDS).build()
    }

    private fun root(ctx: Context) = File(ctx.filesDir, "doc_queue").apply { mkdirs() }
    private fun safe(id: String) = id.filter { it.isLetterOrDigit() || it == '_' || it == '-' }
    private fun userDir(ctx: Context, userId: String) = File(root(ctx), safe(userId)).apply { mkdirs() }

    /** A capture → its queue folder. kind: scan | camera. Pages are copied in (and normalized for camera photos). */
    fun add(ctx: Context, userId: String, kind: String, pages: List<Uri>, fromCamera: File? = null): File {
        val clientId = "doc-${UUID.randomUUID()}"
        val dir = File(userDir(ctx, userId), clientId).apply { mkdirs() }
        val names = JSONArray()
        if (fromCamera != null) {
            val f = File(dir, "page1.jpg")
            DocCapture.normalizePhoto(fromCamera, f)
            fromCamera.delete()
            names.put(f.name)
        } else {
            pages.forEachIndexed { i, uri ->
                val f = File(dir, "page${i + 1}.jpg")
                DocCapture.copyUri(ctx, uri, f)
                names.put(f.name)
            }
        }
        for (i in 0 until names.length()) DocCapture.thumb(File(dir, names.getString(i)), File(dir, "thumb${i + 1}.jpg"))
        val meta = JSONObject().put("clientId", clientId).put("userId", userId).put("kind", kind)
            .put("capturedAt", java.time.Instant.now().toString()).put("pages", names)
        File(dir, "meta.json").writeText(meta.toString())
        return dir
    }

    /** Items of the signed-in user, oldest first */
    fun pending(ctx: Context): List<File> {
        val user = TokenStore.userId(ctx) ?: return emptyList()
        return userDir(ctx, user).listFiles { f -> f.isDirectory && File(f, "meta.json").exists() }?.sortedBy { it.lastModified() } ?: emptyList()
    }

    fun count(ctx: Context): Int = pending(ctx).size

    /** Upload one item. Never with another user's token: the item's user must be the one signed in. */
    fun upload(ctx: Context, dir: File, onSent: (() -> Unit)? = null): UploadOutcome {
        val meta = runCatching { JSONObject(File(dir, "meta.json").readText()) }.getOrNull() ?: return UploadOutcome.Failed("The capture is damaged")
        val api = TokenStore.apiBase(ctx) ?: return UploadOutcome.Retry("Open the app once to finish setup")
        val token = TokenStore.token(ctx) ?: return UploadOutcome.Retry("Signed out — open the app to sign in")
        if (TokenStore.userId(ctx) != meta.optString("userId")) return UploadOutcome.Retry("Waiting for its owner to sign in")
        val pages = meta.optJSONArray("pages") ?: JSONArray()
        val kind = meta.optString("kind", "scan")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("kind", kind)
            .addFormDataPart("clientId", meta.optString("clientId"))
            .addFormDataPart("capturedAt", meta.optString("capturedAt"))
        for (i in 0 until pages.length()) {
            val f = File(dir, pages.getString(i))
            if (!f.exists()) return UploadOutcome.Failed("A page is missing")
            // Scan pages → one scan (pages); a camera photo → a photo (file)
            if (kind == "scan") body.addFormDataPart("page", f.name, f.asRequestBody("image/jpeg".toMediaType()))
            else body.addFormDataPart("file", f.name, f.asRequestBody("image/jpeg".toMediaType()))
            val t = File(dir, "thumb${i + 1}.jpg")
            if (t.exists()) body.addFormDataPart(if (kind == "scan") "pthumb" else "thumb", t.name, t.asRequestBody("image/jpeg".toMediaType()))
        }
        val built = body.build()
        val request = Request.Builder().url("$api/api/quick/document").header("Authorization", "Bearer $token")
            .post(if (onSent != null) Uploader.NotifyingBody(built, onSent) else built).build()
        return try {
            client.newCall(request).execute().use { r ->
                val text = r.body.string()
                when {
                    r.isSuccessful -> UploadOutcome.Sent(JSONObject(text))
                    r.code == 401 -> UploadOutcome.Retry("Signed out — open the app to sign in")
                    r.code == 408 || r.code == 429 || r.code >= 500 -> UploadOutcome.Retry("Server busy (HTTP ${r.code})")
                    else -> UploadOutcome.Failed(Uploader.errorMessage(text) ?: "HTTP ${r.code}")
                }
            }
        } catch (e: IOException) {
            UploadOutcome.Retry("No connection")
        } catch (e: JSONException) {
            UploadOutcome.Retry("Unexpected server response")
        }
    }

    fun remove(dir: File) { dir.deleteRecursively() }
}

/** Uploads queued scans / photos (whenever there's a network), then shows the result like a voice note */
class DocUploadWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        var retry = false
        for (dir in DocQueue.pending(applicationContext)) {
            WidgetState.uploading(applicationContext)
            when (val outcome = DocQueue.upload(applicationContext, dir) { WidgetState.processing(applicationContext) }) {
                is UploadOutcome.Sent -> {
                    DocQueue.remove(dir)
                    ResultNotifier.deliver(applicationContext, outcome.response, fromQueue = true)
                }
                is UploadOutcome.Retry -> {
                    retry = true
                    WidgetState.result(applicationContext, "📥 Saved — uploads when you’re online")
                }
                is UploadOutcome.Failed -> {
                    DocQueue.remove(dir)
                    ResultNotifier.failed(applicationContext, "Scan not saved: ${outcome.reason}")
                }
            }
        }
        QuickToggleWidget.updateAll(applicationContext)
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        fun enqueue(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<DocUploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag("doc-upload")
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("doc-upload", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}

/**
 * Widget / app shortcut / Quick Settings tile → Scan or Camera without the app's screens: a transparent activity
 * that opens the scanner or the camera, queues the capture and closes. (From the lock screen Android asks to
 * unlock first: this activity doesn't show over the lock screen.)
 */
class CaptureActivity : ComponentActivity() {
    companion object {
        const val ACTION_SCAN = "com.sanpan003.pocketarchive.SCAN_DOCUMENT"
        const val ACTION_CAMERA = "com.sanpan003.pocketarchive.CAMERA_NOTE"
        private const val STATE_STARTED = "started"
        private const val STATE_PHOTO = "photo"
    }

    private var photo: File? = null
    private lateinit var scanLauncher: ActivityResultLauncher<IntentSenderRequest>
    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        scanLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
            if (r.resultCode == RESULT_OK) queue("scan", DocCapture.pagesOf(r.data), null) else finish()
        }
        cameraLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            val f = photo
            if (ok && f != null && f.length() > 0) queue("camera", emptyList(), f) else { f?.delete(); finish() }
        }
        photo = savedInstanceState?.getString(STATE_PHOTO)?.let { File(it) }
        if (savedInstanceState?.getBoolean(STATE_STARTED) == true) return  // the scanner / camera is already open

        // Signed in and set up? Otherwise the app explains (never upload for nobody / someone else)
        if (TokenStore.token(this) == null || TokenStore.userId(this) == null || TokenStore.apiBase(this) == null) {
            startActivity(Intent(this, MainActivity::class.java).setAction(QuickActions.ACTION_OPEN_ROUTE)
                .putExtra(QuickActions.EXTRA_ROUTE, "/quick").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
            return
        }
        when (intent?.action) {
            ACTION_CAMERA -> {
                val (f, uri) = DocCapture.cameraTarget(this)
                photo = f
                try { cameraLauncher.launch(uri) } catch (e: Exception) { fail("No camera app") }
            }
            else -> GmsDocumentScanning.getClient(DocCapture.scannerOptions(30)).getStartScanIntent(this)
                .addOnSuccessListener { scanLauncher.launch(IntentSenderRequest.Builder(it).build()) }
                .addOnFailureListener { fail("The scanner needs Google Play services") }
        }
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        out.putBoolean(STATE_STARTED, true)
        photo?.let { out.putString(STATE_PHOTO, it.path) }
    }

    private fun fail(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
        finish()
    }

    private fun queue(kind: String, pages: List<Uri>, cameraFile: File?) {
        val user = TokenStore.userId(this) ?: return fail("Sign in first")
        val app = applicationContext
        WidgetState.uploading(app)
        Thread {
            try {
                DocQueue.add(app, user, kind, pages, cameraFile)
                DocUploadWorker.enqueue(app)
            } catch (e: Exception) {
                Log.w("DocCapture", "Couldn't keep the capture", e)
                ResultNotifier.failed(app, "Couldn't save the ${if (kind == "scan") "scan" else "photo"}")
            }
        }.start()
        Toast.makeText(this, if (kind == "scan") "Scan saved — reading it…" else "Photo saved — reading it…", Toast.LENGTH_SHORT).show()
        finish()
    }
}
