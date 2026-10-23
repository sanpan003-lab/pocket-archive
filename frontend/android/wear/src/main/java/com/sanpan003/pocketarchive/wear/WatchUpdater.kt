package com.sanpan003.pocketarchive.wear

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Over-the-air updates for the watch app. The watch asks the NAS itself (GET /api/updates/watch/latest)
 * when it has Wi-Fi/LTE of its own; otherwise it asks the phone, which downloads the APK and sends it over
 * the Data Layer (channel /pa/update-apk/<versionCode>/<sha256>). Either way the watch checks the SHA-256,
 * that it's this app with a higher version, and that it's signed with the same certificate, then installs
 * with PackageInstaller — Wear OS asks for a confirm tap.
 */
object WatchUpdater {
    private const val TAG = "WatchUpdater"
    private const val PREFS = "watch_update"
    private const val ID = 6
    const val CHANNEL_APK = "/pa/update-apk"
    const val MSG_UPDATE_REQUEST = "/pa/update-request"
    const val MSG_UPDATE_NOW = "/pa/update-now"
    const val DATA_WATCH_INFO = "/pa/watch-info"
    /** Watch → phone: update progress for the phone's Settings → About */
    const val MSG_UPDATE_STATUS = "/pa/update-status"

    private val client by lazy { OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build() }
    private val _status = MutableStateFlow("")
    /** For the watch's Settings page: "Up to date", "Downloading 40 %", "Update 2.4.0 ready — tap to install" */
    val status: StateFlow<String> = _status.asStateFlow()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun installed(ctx: Context): Pair<Long, String> {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
        return code to (pi.versionName ?: "")
    }

    /** Tell the phone which version this watch runs (phone → Settings, and the server via the phone) */
    fun publishVersion(ctx: Context) {
        val (code, name) = installed(ctx)
        val req = PutDataMapRequest.create(DATA_WATCH_INFO).apply {
            dataMap.putLong("versionCode", code); dataMap.putString("versionName", name)
        }.asPutDataRequest()
        Wearable.getDataClient(ctx).putDataItem(req).addOnFailureListener { Log.i(TAG, "Version not sent: ${it.message}") }
    }

    /** Internet of the watch's own (Wi-Fi / LTE), or through the phone's Bluetooth link */
    private fun hasInternet(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Status on the watch's Settings page, and on the phone (Settings → About) */
    private fun say(ctx: Context, text: String) {
        _status.value = text
        val app = ctx.applicationContext
        runCatching {
            Wearable.getCapabilityClient(app).getCapability(Protocol.CAP_PHONE, com.google.android.gms.wearable.CapabilityClient.FILTER_REACHABLE)
                .addOnSuccessListener { cap -> cap.nodes.forEach { Wearable.getMessageClient(app).sendMessage(it.id, MSG_UPDATE_STATUS, text.toByteArray()) } }
        }
    }

    /** Check (and update if there's something newer). manual = "Check for updates" on the watch / phone's "Update watch". */
    /**
     * Check (and update if there's something newer). First the watch's own way (its token + Wi-Fi/LTE or the
     * phone's Bluetooth internet); if that isn't possible or fails, the phone downloads and sends it.
     */
    fun checkAndUpdate(ctx: Context, manual: Boolean) {
        publishVersion(ctx)
        val creds = WatchTokenStore.get(ctx)
        if (creds == null || !hasInternet(ctx)) {
            say(ctx, if (creds == null) "Asking the phone to send the update…" else "No network on the watch — asking the phone…")
            askPhone(ctx)
            return
        }
        val (token, api) = creds
        val (code, name) = installed(ctx)
        val reason = try {
            val latest = client.newCall(Request.Builder().url("$api/api/updates/watch/latest?versionCode=$code&versionName=${android.net.Uri.encode(name)}")
                .header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (!r.isSuccessful) throw DirectProblem(if (r.code == 401) "the watch's sign-in expired" else "the server answered ${r.code}")
                JSONObject(r.body.string())
            }
            if (latest.optBoolean("rolledBack") || !latest.optBoolean("available")) { say(ctx, "Up to date ($name)"); return }
            val newCode = latest.optLong("versionCode")
            val newName = latest.optString("versionName")
            say(ctx, "Downloading $newName on the watch…")
            val apk = client.newCall(Request.Builder().url("$api/api/updates/watch/apk").header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (!r.isSuccessful) throw DirectProblem("the download failed (${r.code})")
                val total = latest.optLong("size").takeIf { it > 0 } ?: r.body.contentLength()
                save(ctx, newCode, r.body.byteStream(), total) { pct -> say(ctx, "Downloading $newName on the watch… $pct %") }
            }
            verifyAndInstall(ctx, apk, latest.optString("sha256"), newCode, api, token)
            return
        } catch (e: DirectProblem) {
            e.message
        } catch (e: Exception) {
            Log.i(TAG, "Direct update failed", e)
            "no connection to the server"
        }
        Log.i(TAG, "Direct update failed ($reason); asking the phone")
        say(ctx, "Watch couldn't download it ($reason) — asking the phone…")
        askPhone(ctx)
    }

    private class DirectProblem(message: String) : Exception(message)

    private fun askPhone(ctx: Context) = runCatching {
        val nodes = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(Protocol.CAP_PHONE, com.google.android.gms.wearable.CapabilityClient.FILTER_REACHABLE), 10, TimeUnit.SECONDS).nodes
        if (nodes.isEmpty()) _status.value = "No phone or network — try again later"
        for (n in nodes) Wearable.getMessageClient(ctx).sendMessage(n.id, MSG_UPDATE_REQUEST, ByteArray(0))
    }.onFailure { _status.value = "No phone or network — try again later" }

    private fun save(ctx: Context, code: Long, input: InputStream, total: Long = -1, progress: ((Int) -> Unit)? = null): File {
        val dir = File(ctx.filesDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, "watch-$code.apk")
        f.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            var done = 0L
            var shown = -1
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                done += n
                if (progress != null && total > 0) {
                    val pct = (done * 100 / total).toInt()
                    if (pct / 10 != shown / 10) { shown = pct; progress(pct) }
                }
            }
        }
        return f
    }

    /** From the phone over the Data Layer */
    fun receiveFromPhone(ctx: Context, path: String, input: InputStream) {
        val parts = path.removePrefix("$CHANNEL_APK/").split('/')
        val code = parts.getOrNull(0)?.toLongOrNull() ?: return
        val sha = parts.getOrNull(1) ?: return
        say(ctx, "Watch is receiving the update…")
        val apk = save(ctx, code, input)
        verifyAndInstall(ctx, apk, sha, code, null, null)
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s -> val b = ByteArray(64 * 1024); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo, current: Boolean): Set<String> {
        val certs = if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            val si = info.signingInfo!!
            when {
                si.hasMultipleSigners() -> si.apkContentsSigners
                current -> si.signingCertificateHistory?.takeLast(1)?.toTypedArray()
                else -> si.signingCertificateHistory
            }
        } else info.signatures
        return certs?.map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
    }

    /** null = OK */
    fun verify(ctx: Context, apk: File, sha: String, code: Long): String? {
        if (sha.isBlank() || sha256(apk) != sha.lowercase()) return "checksum doesn't match"
        val pm = ctx.packageManager
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.path, flags) ?: return "not a valid app package"
        if (archive.packageName != ctx.packageName) return "a different app"
        val archiveCode = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong()
        if (archiveCode != code || archiveCode <= installed(ctx).first) return "version doesn't match"
        val ours = signers(pm.getPackageInfo(ctx.packageName, flags), current = false)
        val theirs = signers(archive, current = true)
        if (theirs.isEmpty() || !ours.containsAll(theirs)) return "not signed with the Pocket Archive key"
        return null
    }

    private fun verifyAndInstall(ctx: Context, apk: File, sha: String, code: Long, api: String?, token: String?) {
        val problem = verify(ctx, apk, sha, code)
        if (problem != null) {
            apk.delete()
            Log.w(TAG, "Rejected: $problem")
            say(ctx, "Watch rejected the update: $problem")
            report(ctx, api, token, "rejected", code, problem)
            return
        }
        // Not while recording
        if (WatchState.isRecording) { say(ctx, "Update ready — installs on the watch after the recording"); prefs(ctx).edit().putString("pending", apk.path).apply(); return }
        install(ctx, apk, code)
    }

    fun installPending(ctx: Context) {
        val path = prefs(ctx).getString("pending", null) ?: return
        prefs(ctx).edit().remove("pending").apply()
        val f = File(path)
        if (f.exists()) install(ctx, f, f.name.removePrefix("watch-").removeSuffix(".apk").toLongOrNull() ?: 0)
    }

    private fun install(ctx: Context, apk: File, code: Long) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(ctx.packageName)
                setSize(apk.length())
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { s ->
                s.openWrite("base.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java).putExtra("code", code),
                    PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))
                say(ctx, "Confirm on your watch")
                prefs(ctx).edit().putLong("installingCode", code).apply()
                s.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Install failed", e)
            say(ctx, "Watch couldn't install the update — try again")
        }
    }

    /** After the new version starts: tell the phone/server */
    fun afterStart(ctx: Context) {
        val code = prefs(ctx).getLong("installingCode", 0)
        if (code > 0 && installed(ctx).first >= code) {
            prefs(ctx).edit().remove("installingCode").apply()
            File(ctx.filesDir, "updates").listFiles()?.forEach { it.delete() }
            val creds = WatchTokenStore.get(ctx)
            report(ctx, creds?.second, creds?.first, "installed", code, null)
        }
        publishVersion(ctx)
    }

    private fun report(ctx: Context, api: String?, token: String?, event: String, code: Long, detail: String?) {
        val creds = if (api != null && token != null) token to api else WatchTokenStore.get(ctx) ?: return
        Thread {
            runCatching {
                val body = JSONObject().put("event", event).put("versionCode", code).put("versionName", installed(ctx).second).apply { if (detail != null) put("detail", detail) }.toString()
                client.newCall(Request.Builder().url("${creds.second}/api/updates/watch/report").header("Authorization", "Bearer ${creds.first}")
                    .post(body.toRequestBody("application/json".toMediaType())).build()).execute().close()
            }
        }.start()
    }

    fun confirmNotification(ctx: Context, confirm: Intent) {
        WatchNotifications.ensureChannels(ctx)
        WatchNotifications.notify(ctx, ID, NotificationCompat.Builder(ctx, WatchNotifications.CH_RESULT)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(WatchNotifications.BRAND)
            .setContentTitle("Update ready")
            .setContentText("Tap to install")
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(ctx, 61, confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)))
        say(ctx, "Confirm on your watch (tap the notification there)")
    }

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<CheckWorker>(1, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("watch-update-check", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun checkNow(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniqueWork("watch-update-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<CheckWorker>().build())
    }

    class CheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
        override suspend fun doWork(): Result { checkAndUpdate(applicationContext, manual = false); return Result.success() }
    }

    class InstallReceiver : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                    // Wear OS always asks: try to show it now, else a notification to tap
                    try { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { confirmNotification(ctx, confirm) }
                }
                PackageInstaller.STATUS_SUCCESS -> afterStart(ctx)
                else -> {
                    say(ctx, if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "Update cancelled on the watch" else "Watch couldn't install the update (${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: status})")
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("installingCode").apply()
                }
            }
        }
    }
}
