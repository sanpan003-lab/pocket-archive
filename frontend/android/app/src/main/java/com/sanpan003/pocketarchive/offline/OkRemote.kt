package com.sanpan003.pocketarchive.offline

import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** The NAS over OkHttp with the device token (never the capture-only one: that's refused with 403 locked) */
class OkRemote(private val apiBase: String, private val token: String) : Remote {
    companion object {
        private val JSON = "application/json".toMediaType()
        private val client by lazy {
            OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
        }
    }

    private fun req(path: String) = Request.Builder().url(apiBase.trimEnd('/') + path).header("Authorization", "Bearer $token")

    override fun json(method: String, path: String, body: JSONObject?): Remote.Res {
        val rb = when {
            body != null -> body.toString().toRequestBody(JSON)
            method == "GET" || method == "HEAD" -> null
            else -> ByteArray(0).toRequestBody(JSON)
        }
        client.newCall(req(path).method(method, rb).build()).execute().use { r -> return Remote.Res(r.code, r.body.string()) }
    }

    override fun form(method: String, path: String, parts: JSONArray): Remote.Res {
        val mb = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (i in 0 until parts.length()) {
            val p = parts.getJSONObject(i)
            val name = p.getString("name")
            val file = p.optJSONObject("file")
            if (file != null) {
                val bytes = Base64.decode(file.getString("base64"), Base64.DEFAULT)
                mb.addFormDataPart(name, file.optString("filename", name), bytes.toRequestBody(file.optString("type", "application/octet-stream").toMediaTypeOrNull()))
            } else mb.addFormDataPart(name, p.optString("value"))
        }
        client.newCall(req(path).method(method, mb.build()).build()).execute().use { r -> return Remote.Res(r.code, r.body.string()) }
    }

    override fun download(path: String, from: Long, start: (Int, String?, Long?) -> Unit, bytes: (ByteArray, Int) -> Unit) {
        val b = req(path)
        if (from > 0) b.header("Range", "bytes=$from-")
        client.newCall(b.build()).execute().use { r ->
            start(r.code, r.header("Content-Type"), r.body.contentLength().takeIf { it >= 0 })
            if (r.code != 200 && r.code != 206) return
            val src = r.body.byteStream()
            val buf = ByteArray(32 * 1024)
            while (true) {
                val n = src.read(buf)
                if (n < 0) break
                bytes(buf, n)
            }
        }
    }
}

/**
 * Is the NAS reachable right now? A quick GET /api/health (2.5 s), remembered for 20 s; Android's network callbacks
 * ask again when the connection changes. The app shell uses it to open the bundled screens instead of waiting.
 */
object NasProbe {
    @Volatile var reachable: Boolean? = null
        private set
    @Volatile private var checkedAt = 0L
    private val listeners = mutableListOf<(Boolean) -> Unit>()
    private val client by lazy { OkHttpClient.Builder().connectTimeout(2500, TimeUnit.MILLISECONDS).readTimeout(3, TimeUnit.SECONDS).callTimeout(4, TimeUnit.SECONDS).build() }

    fun onChange(fn: (Boolean) -> Unit) = synchronized(listeners) { listeners += fn }

    private fun set(v: Boolean) {
        val changed = reachable != v
        reachable = v
        checkedAt = System.currentTimeMillis()
        if (changed) synchronized(listeners) { listeners.toList() }.forEach { runCatching { it(v) } }
    }

    /** Blocking (call off the main thread). maxAgeMs: reuse a recent answer. */
    fun check(apiBase: String?, maxAgeMs: Long = 20_000): Boolean {
        reachable?.let { if (System.currentTimeMillis() - checkedAt < maxAgeMs) return it }
        if (apiBase.isNullOrBlank()) return false
        val ok = try {
            client.newCall(Request.Builder().url(apiBase.trimEnd('/') + "/api/health").build()).execute().use { it.isSuccessful }
        } catch (e: IOException) { false }
        set(ok)
        return ok
    }

    fun markUnreachable() = set(false)
    fun forget() { checkedAt = 0 }
}
