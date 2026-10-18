package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Sends queued watch recordings. Primary path: to the phone, which uploads
 * them with its own pipeline. Fallback: if the phone has been away for
 * 10+ minutes and the watch has internet, upload directly with the shared
 * device token. Retries with backoff (and right away when the phone
 * reconnects, via WatchListenerService).
 */
class SendWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val files = CaptureQueue.pending(ctx)
        if (files.isEmpty()) return Result.success()

        val phone = PhoneLink.phone(ctx)
        var waiting = false
        for (file in files) {
            if (phone != null && PhoneLink.sendCapture(ctx, phone, file)) {
                CaptureQueue.remove(ctx, file)
                if (!WatchState.isRecording) WatchState.set(Phase.Sent)
                continue
            }
            val age = System.currentTimeMillis() - CaptureQueue.meta(file).capturedAt
            if (age >= DIRECT_AFTER_MS && hasOwnInternet(ctx)) {
                when (val r = directUpload(ctx, file)) {
                    is Direct.Sent -> { CaptureQueue.remove(ctx, file); ResultPresenter.show(ctx, r.confirmation) }
                    is Direct.Failed -> {
                        CaptureQueue.remove(ctx, file)
                        ResultPresenter.show(ctx, JSONObject().put("icon", "⚠️").put("text", "Couldn't save voice note").put("tone", "review").put("detail", r.reason))
                    }
                    Direct.Retry -> waiting = true
                }
                continue
            }
            waiting = true
        }
        WatchState.refreshQueue(ctx)
        if (waiting) {
            if (!WatchState.isRecording && WatchState.phase.value is Phase.Sending) WatchState.set(Phase.Queued)
            return Result.retry()
        }
        return Result.success()
    }

    private sealed class Direct {
        data class Sent(val confirmation: JSONObject) : Direct()
        data class Failed(val reason: String) : Direct()
        data object Retry : Direct()
    }

    /** Same request as the phone app: POST /api/quick/capture with the device token. */
    private fun directUpload(ctx: Context, file: File): Direct {
        val (token, apiBase) = WatchTokenStore.get(ctx) ?: return Direct.Retry
        val meta = CaptureQueue.meta(file)
        // Never upload one user's recording with another user's token: wait for the phone
        if (meta.userId != null && meta.userId != WatchTokenStore.userId(ctx)) return Direct.Retry
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("audio", "capture.m4a", file.asRequestBody("audio/mp4".toMediaType()))
            .addFormDataPart("clientId", meta.clientId)
            .addFormDataPart("capturedAt", Instant.ofEpochMilli(meta.capturedAt).toString())
            .build()
        val request = Request.Builder()
            .url("$apiBase/api/quick/capture")
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()
        return try {
            client.newCall(request).execute().use { r ->
                val text = r.body.string()
                when {
                    r.isSuccessful -> Direct.Sent(
                        JSONObject(text).optJSONObject("confirmation")
                            ?: JSONObject().put("icon", "📝").put("text", "Voice note saved").put("tone", "success"),
                    )
                    r.code == 401 -> { WatchTokenStore.set(ctx, null, null); Direct.Retry } // revoked: wait for the phone
                    r.code == 408 || r.code == 429 || r.code >= 500 -> Direct.Retry
                    else -> Direct.Failed(runCatching { JSONObject(text).optString("error") }.getOrNull() ?: "HTTP ${r.code}")
                }
            }
        } catch (e: IOException) {
            Log.i(TAG, "Direct upload failed: ${e.message}")
            Direct.Retry
        }
    }

    /** Wi-Fi/LTE of its own (not just the Bluetooth link to the phone). */
    private fun hasOwnInternet(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)
    }

    companion object {
        private const val TAG = "SendWorker"
        const val DIRECT_AFTER_MS = 10 * 60_000L

        private val client by lazy {
            OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .build()
        }

        /** Try now (and keep retrying with backoff). */
        fun sendNow(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<SendWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("watch-send", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
