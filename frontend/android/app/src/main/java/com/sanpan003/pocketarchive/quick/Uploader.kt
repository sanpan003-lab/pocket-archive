package com.sanpan003.pocketarchive.quick

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

sealed class UploadOutcome {
    data class Sent(val response: JSONObject) : UploadOutcome()
    /** Temporary problem (offline, server down, signed out) — try again later. */
    data class Retry(val reason: String) : UploadOutcome()
    /** Will never succeed (bad audio, too large) — give up. */
    data class Failed(val reason: String) : UploadOutcome()
}

/** POST /api/quick/capture with the device token. */
object Uploader {
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS) // transcription + classification
            .build()
    }

    fun upload(ctx: Context, file: File): UploadOutcome {
        val apiBase = TokenStore.apiBase(ctx) ?: return UploadOutcome.Retry("Open the app once to finish setup")
        val token = TokenStore.token(ctx) ?: return UploadOutcome.Retry("Signed out — open the app to sign in")
        if (!file.exists() || file.length() == 0L) return UploadOutcome.Failed("Recording file is missing")

        val meta = PendingStore.meta(file)
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("audio", "capture.m4a", file.asRequestBody("audio/mp4".toMediaType()))
            .addFormDataPart("clientId", meta.clientId)
            .addFormDataPart("capturedAt", meta.capturedAtIso)
            .build()
        val request = Request.Builder()
            .url("$apiBase/api/quick/capture")
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                val text = response.body.string()
                when {
                    response.isSuccessful -> UploadOutcome.Sent(JSONObject(text))
                    response.code == 401 -> UploadOutcome.Retry("Signed out — open the app to sign in")
                    response.code == 408 || response.code == 429 || response.code >= 500 ->
                        UploadOutcome.Retry("Server busy (HTTP ${response.code})")
                    else -> UploadOutcome.Failed(errorMessage(text) ?: "HTTP ${response.code}")
                }
            }
        } catch (e: IOException) {
            UploadOutcome.Retry("No connection")
        } catch (e: JSONException) {
            UploadOutcome.Retry("Unexpected server response")
        }
    }

    private fun errorMessage(text: String): String? =
        runCatching { JSONObject(text).optString("error").takeIf { it.isNotBlank() } }.getOrNull()
}
