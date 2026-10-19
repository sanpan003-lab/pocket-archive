package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/** The watch app's version, as the watch reported it (DataItem /pa/watch-info) — shown in Settings, sent to the server */
object WatchVersion {
    const val DATA_WATCH_INFO = "/pa/watch-info"
    private const val PREFS = "watch_version"
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun set(ctx: Context, code: Long, name: String?) =
        prefs(ctx).edit().putLong("code", code).putString("name", name).putLong("at", System.currentTimeMillis()).apply()

    fun get(ctx: Context): Pair<Long, String>? {
        val code = prefs(ctx).getLong("code", 0)
        return if (code > 0) code to (prefs(ctx).getString("name", "") ?: "") else null
    }

    fun json(ctx: Context): Any = get(ctx)?.let {
        JSONObject().put("versionCode", it.first).put("versionName", it.second).put("at", prefs(ctx).getLong("at", 0))
            .put("status", prefs(ctx).getString("status", "") ?: "")
    } ?: JSONObject.NULL

    fun setStatus(ctx: Context, status: String) {
        prefs(ctx).edit().putString("status", status).apply()
        QuickRecorderPlugin.deliverUpdate(AppUpdater.state(ctx))
    }
}

/**
 * Watch without its own network: the phone downloads the watch APK and sends it over the Data Layer
 * (channel /pa/update-apk/<versionCode>/<sha256>). The phone checks the SHA-256 and that it's signed with
 * the same key as this app; the watch checks everything again before installing.
 */
object WatchUpdateRelay {
    private const val TAG = "WatchUpdateRelay"
    const val CHANNEL_APK = "/pa/update-apk"
    const val MSG_UPDATE_REQUEST = "/pa/update-request"
    const val MSG_UPDATE_NOW = "/pa/update-now"
    private val client by lazy { OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build() }

    /** "Update watch" in the app: the watch checks itself (and asks back here when it has no network) */
    fun updateNow(ctx: Context) = WearBridge.async {
        val nodes = WearBridge.watches(ctx)
        if (nodes.isEmpty()) { WatchVersion.setStatus(ctx, "Watch not connected"); return@async }
        for (n in nodes) WearBridge.send(ctx, n.id, MSG_UPDATE_NOW)
        WatchVersion.setStatus(ctx, "Asked the watch to update")
    }

    fun relay(ctx: Context) {
        val api = TokenStore.apiBase(ctx) ?: return
        val token = TokenStore.token(ctx) ?: return
        val w = WatchVersion.get(ctx)
        try {
            val latest = client.newCall(Request.Builder().url("$api/api/updates/watch/latest?versionCode=${w?.first ?: 0}&versionName=${w?.second ?: ""}")
                .header("Authorization", "Bearer $token").build()).execute().use { JSONObject(it.body.string()) }
            val code = latest.optLong("versionCode")
            if (w != null && code <= w.first) { WatchVersion.setStatus(ctx, "Watch is up to date"); return }
            if (code <= 0) { WatchVersion.setStatus(ctx, "No watch update published"); return }
            WatchVersion.setStatus(ctx, "Downloading the watch update…")
            val f = File(ctx.cacheDir, "watch-update.apk")
            client.newCall(Request.Builder().url("$api/api/updates/watch/apk").header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (!r.isSuccessful) throw java.io.IOException("HTTP ${r.code}")
                f.outputStream().use { r.body.byteStream().copyTo(it) }
            }
            val sha = latest.optString("sha256")
            if (AppUpdater.sha256(f) != sha) { f.delete(); WatchVersion.setStatus(ctx, "Watch update rejected: checksum"); return }
            // Same key as this phone app (the phone and watch apps are signed alike)
            @Suppress("DEPRECATION")
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val archive = ctx.packageManager.getPackageArchiveInfo(f.path, flags)
            val ours = AppUpdater.signers(ctx.packageManager.getPackageInfo(ctx.packageName, flags), current = false)
            if (archive == null || !ours.containsAll(AppUpdater.signers(archive, current = true))) {
                f.delete(); WatchVersion.setStatus(ctx, "Watch update rejected: wrong signature"); return
            }
            val nodes = WearBridge.watches(ctx)
            if (nodes.isEmpty()) { WatchVersion.setStatus(ctx, "Watch not connected"); return }
            WatchVersion.setStatus(ctx, "Sending the update to the watch…")
            val channels = Wearable.getChannelClient(ctx)
            for (n in nodes) {
                val ch = Tasks.await(channels.openChannel(n.id, "$CHANNEL_APK/$code/$sha"), 20, TimeUnit.SECONDS)
                Tasks.await(channels.getOutputStream(ch), 20, TimeUnit.SECONDS).use { out -> f.inputStream().use { it.copyTo(out) } }
                channels.close(ch)
            }
            f.delete()
            WatchVersion.setStatus(ctx, "Sent — confirm on the watch")
        } catch (e: Exception) {
            Log.w(TAG, "Relay failed", e)
            WatchVersion.setStatus(ctx, "Couldn't update the watch: ${e.message}")
        }
    }
}
