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

    fun set(ctx: Context, code: Long, name: String?) {
        val before = prefs(ctx).getLong("code", 0)
        val pending = prefs(ctx).getLong("pendingCode", 0)
        prefs(ctx).edit().putLong("code", code).putString("name", name).putLong("at", System.currentTimeMillis()).apply()
        // An update we sent (or the watch fetched itself) went through
        if ((pending > 0 && code >= pending) || (before > 0 && code > before)) {
            prefs(ctx).edit().remove("pendingCode").apply()
            setStatus(ctx, "Updated to ${name?.takeIf { it.isNotBlank() } ?: code}")
        } else QuickRecorderPlugin.deliverUpdate(AppUpdater.state(ctx))
    }

    /** The watch was sent [code] and has to confirm it ("Updated to X" once it reports that version) */
    fun setPending(ctx: Context, code: Long) = prefs(ctx).edit().putLong("pendingCode", code).apply()

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

/** Why a watch update couldn't go ahead — shown as is (never a file path or a raw exception) */
class RelayProblem(message: String) : Exception(message)

/**
 * Watch without its own network: the phone downloads the watch APK (with progress) into its cache, checks the
 * SHA-256 and that it's signed with the same key as this app, THEN sends it over the Data Layer (channel
 * /pa/update-apk/<versionCode>/<sha256>). The watch checks everything again and asks for a confirm tap.
 * Status on the phone (Settings → About): Downloading… → Sending to watch… → Confirm on your watch → Updated to X.
 */
object WatchUpdateRelay {
    private const val TAG = "WatchUpdateRelay"
    const val CHANNEL_APK = "/pa/update-apk"
    const val MSG_UPDATE_REQUEST = "/pa/update-request"
    const val MSG_UPDATE_NOW = "/pa/update-now"
    /** Watch → phone: its own update progress ("Downloading 40 %", "Confirm on your watch", "Up to date") */
    const val MSG_UPDATE_STATUS = "/pa/update-status"
    private val client by lazy { OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build() }
    /** One transfer at a time (a second request while one runs is ignored, not started in parallel) */
    private val running = java.util.concurrent.atomic.AtomicBoolean(false)

    /** "Update watch" in the app: the watch tries its own Wi-Fi first and asks back here when it has no network */
    fun updateNow(ctx: Context) = WearBridge.async {
        val nodes = WearBridge.watches(ctx)
        if (nodes.isEmpty()) { WatchVersion.setStatus(ctx, "Watch not connected — open Pocket Archive on the watch, or check Bluetooth"); return@async }
        WatchVersion.setStatus(ctx, "Asking the watch…")
        for (n in nodes) WearBridge.send(ctx, n.id, MSG_UPDATE_NOW)
    }

    fun relay(ctx: Context) {
        if (!running.compareAndSet(false, true)) { Log.i(TAG, "A transfer is already running"); return }
        val dir = File(ctx.cacheDir, "watch-update").apply { mkdirs() }
        var file: File? = null
        try {
            file = relayOnce(ctx, dir) { file = it }
        } catch (e: RelayProblem) {
            WatchVersion.setStatus(ctx, "Couldn't update the watch: ${e.message}")
        } catch (e: java.util.concurrent.TimeoutException) {
            WatchVersion.setStatus(ctx, "Couldn't update the watch: the watch didn't answer — keep it close and try again")
        } catch (e: java.io.IOException) {
            Log.w(TAG, "Relay network error", e)
            WatchVersion.setStatus(ctx, "Couldn't update the watch: no connection to your server — try again on Wi-Fi")
        } catch (e: Exception) {
            Log.w(TAG, "Relay failed", e)
            WatchVersion.setStatus(ctx, "Couldn't update the watch — try again")
        } finally {
            file?.delete()
            dir.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 3_600_000L }?.forEach { it.delete() }
            running.set(false)
        }
    }

    /** [made] gets the cache file as soon as it exists (so it's always cleaned up) */
    private fun relayOnce(ctx: Context, dir: File, made: (File) -> Unit): File? {
        val api = TokenStore.apiBase(ctx) ?: throw RelayProblem("sign in on the phone first")
        val token = TokenStore.token(ctx) ?: throw RelayProblem("sign in on the phone first")
        val w = WatchVersion.get(ctx)
        // Respect "Wi-Fi only" (Settings → About): the watch app is ~30 MB
        if (AppUpdater.wifiOnly(ctx) && isMetered(ctx)) throw RelayProblem("waiting for Wi-Fi (Settings → About → “Wi-Fi only” is on)")

        val latest = client.newCall(Request.Builder().url("$api/api/updates/watch/latest?versionCode=${w?.first ?: 0}&versionName=${android.net.Uri.encode(w?.second ?: "")}")
            .header("Authorization", "Bearer $token").build()).execute().use { r ->
            when {
                r.code == 401 -> throw RelayProblem("the phone is signed out — sign in again")
                r.code == 404 -> throw RelayProblem("your server doesn't offer watch updates yet")
                !r.isSuccessful -> throw RelayProblem("your server answered ${r.code}")
            }
            JSONObject(r.body.string())
        }
        val code = latest.optLong("versionCode")
        val name = latest.optString("versionName")
        if (code <= 0) throw RelayProblem("no watch update is published")
        if (w != null && code <= w.first) { WatchVersion.setStatus(ctx, "Watch is up to date (${w.second})"); return null }
        val sha = latest.optString("sha256")
        val size = latest.optLong("size")

        // 1. Download into its own file in the cache (one per run), with progress
        val f = File.createTempFile("watch-$code-", ".apk", dir)
        made(f)
        WatchVersion.setStatus(ctx, "Downloading $name…")
        client.newCall(Request.Builder().url("$api/api/updates/watch/apk").header("Authorization", "Bearer $token").build()).execute().use { r ->
            when {
                r.code == 404 -> throw RelayProblem("the watch app file is missing on your server")
                !r.isSuccessful -> throw RelayProblem("the download failed (${r.code})")
            }
            val total = if (size > 0) size else r.body.contentLength()
            f.outputStream().use { out ->
                val input = r.body.byteStream()
                val buf = ByteArray(64 * 1024)
                var done = 0L
                var shown = -1
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    val pct = if (total > 0) (done * 100 / total).toInt() else -1
                    if (pct >= 0 && pct / 5 != shown / 5) { shown = pct; WatchVersion.setStatus(ctx, "Downloading $name… $pct %") }
                }
            }
        }
        // 2. Check it before it goes anywhere
        if (sha.isBlank() || AppUpdater.sha256(f) != sha.lowercase()) throw RelayProblem("the download was damaged (checksum mismatch) — try again")
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = ctx.packageManager.getPackageArchiveInfo(f.path, flags) ?: throw RelayProblem("the file isn't a valid watch app")
        val ours = AppUpdater.signers(ctx.packageManager.getPackageInfo(ctx.packageName, flags), current = false)
        val theirs = AppUpdater.signers(archive, current = true)
        if (theirs.isEmpty() || !ours.containsAll(theirs)) throw RelayProblem("it isn't signed with the Pocket Archive key")

        // 3. Send it to the watch
        val nodes = WearBridge.watches(ctx)
        if (nodes.isEmpty()) throw RelayProblem("the watch isn't connected")
        val channels = Wearable.getChannelClient(ctx)
        for (n in nodes) {
            WatchVersion.setStatus(ctx, "Sending to watch…")
            val ch = Tasks.await(channels.openChannel(n.id, "$CHANNEL_APK/$code/$sha"), 20, TimeUnit.SECONDS)
            try {
                Tasks.await(channels.getOutputStream(ch), 20, TimeUnit.SECONDS).use { out ->
                    f.inputStream().use { input ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        var shown = -1
                        while (true) {
                            val k = input.read(buf)
                            if (k < 0) break
                            out.write(buf, 0, k)
                            done += k
                            val pct = (done * 100 / f.length()).toInt()
                            if (pct / 10 != shown / 10) { shown = pct; WatchVersion.setStatus(ctx, "Sending to watch… $pct %") }
                        }
                    }
                }
            } finally {
                runCatching { channels.close(ch) }
            }
        }
        WatchVersion.setPending(ctx, code)
        WatchVersion.setStatus(ctx, "Confirm on your watch")
        return f
    }

    private fun isMetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(android.net.ConnectivityManager::class.java) ?: return false
        return cm.isActiveNetworkMetered
    }
}
