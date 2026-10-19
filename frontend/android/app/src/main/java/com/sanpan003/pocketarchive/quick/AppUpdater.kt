package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.sanpan003.pocketarchive.BuildConfig
import com.sanpan003.pocketarchive.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Over-the-air updates from the NAS (no Play Store). Checks on app open and daily, offers
 * "Update X available · What's new", downloads with progress (resumable), and installs only an APK that
 *   - matches the published SHA-256,
 *   - is this app (same package) with a higher versionCode,
 *   - is signed with the SAME certificate as the installed app.
 * Installs through a PackageInstaller session (silent where Android allows it: USER_ACTION_NOT_REQUIRED
 * once this app installed the previous version itself; otherwise Android's confirm dialog). Never
 * while recording: the install waits until the recording ends.
 */
object AppUpdater {
    private const val TAG = "AppUpdater"
    private const val PREFS = "app_update"
    private const val ID_UPDATE = 1012
    const val TARGET = "phone"

    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    }
    /** Download / deferred install / install session running in THIS process (stale states after a restart are reset) */
    @Volatile private var busy = false

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ── State (for the app's banner / Settings → About) ────────────────────

    /** { current, currentCode, latest?, status: idle|available|downloading|ready|installing|deferred|failed|rolledBack, progress, error?, lastCheckAt, wifiOnly, canInstall, watch? } */
    fun state(ctx: Context): JSONObject {
        val p = prefs(ctx)
        return JSONObject()
            .put("current", BuildConfig.VERSION_NAME).put("currentCode", BuildConfig.VERSION_CODE)
            .put("latest", p.getString("latest", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL)
            .put("status", p.getString("status", "idle"))
            .put("progress", p.getInt("progress", 0))
            .put("error", p.getString("error", null) ?: JSONObject.NULL)
            .put("lastCheckAt", p.getLong("lastCheckAt", 0))
            .put("wifiOnly", p.getBoolean("wifiOnly", true))
            .put("canInstall", Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls())
            .put("watch", WatchVersion.json(ctx))
    }

    private fun setStatus(ctx: Context, status: String, progress: Int = 0, error: String? = null) {
        prefs(ctx).edit().putString("status", status).putInt("progress", progress).putString("error", error).apply()
        QuickRecorderPlugin.deliverUpdate(state(ctx))
    }

    fun setWifiOnly(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("wifiOnly", on).apply()
        schedule(ctx, replace = true)
    }

    // ── Check ──────────────────────────────────────────────────────────────

    /** GET /api/updates/phone/latest (reports this version + the watch's). Returns the state. */
    fun check(ctx: Context, manual: Boolean): JSONObject {
        val api = TokenStore.apiBase(ctx) ?: return state(ctx)
        val token = TokenStore.token(ctx) ?: return state(ctx)
        val w = WatchVersion.get(ctx)
        val url = "$api/api/updates/$TARGET/latest?versionCode=${BuildConfig.VERSION_CODE}&versionName=${Uri.encode(BuildConfig.VERSION_NAME)}" +
            (w?.let { "&watchVersionCode=${it.first}&watchVersionName=${Uri.encode(it.second)}" } ?: "")
        try {
            client.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (!r.isSuccessful) { if (manual) setStatus(ctx, "failed", error = "Server said ${r.code}"); return state(ctx) }
                val body = JSONObject(r.body.string())
                val p = prefs(ctx)
                p.edit().putLong("lastCheckAt", System.currentTimeMillis()).apply()
                if (body.isNull("latest") && !body.has("versionCode")) {
                    p.edit().remove("latest").apply()
                    setStatus(ctx, "idle")
                    return state(ctx)
                }
                p.edit().putString("latest", body.toString()).apply()
                val code = body.optInt("versionCode")
                when {
                    body.optBoolean("rolledBack") -> setStatus(ctx, "rolledBack")
                    code > BuildConfig.VERSION_CODE -> {
                        val cur = p.getString("status", "idle")
                        if (cur !in setOf("downloading", "ready", "installing", "deferred")) setStatus(ctx, "available")
                        // Notify once per version (or when asked)
                        if (manual || p.getInt("notifiedCode", 0) != code) {
                            p.edit().putInt("notifiedCode", code).apply()
                            if (!manual) notifyAvailable(ctx, body)
                        }
                    }
                    else -> setStatus(ctx, "idle")
                }
            }
        } catch (e: Exception) {
            Log.i(TAG, "Check failed: ${e.javaClass.simpleName}")
            if (manual) setStatus(ctx, "failed", error = "Couldn't reach the server")
        }
        return state(ctx)
    }

    // ── Download + verify ──────────────────────────────────────────────────

    private fun file(ctx: Context, code: Int) = File(File(ctx.filesDir, "updates").apply { mkdirs() }, "phone-$code.apk")

    /** Download (resuming a partial file), then verify. Returns the verified file or null (status says why). */
    fun download(ctx: Context): File? {
        val latest = prefs(ctx).getString("latest", null)?.let { JSONObject(it) } ?: return null
        val code = latest.optInt("versionCode")
        val sha = latest.optString("sha256")
        val size = latest.optLong("size")
        if (code <= BuildConfig.VERSION_CODE) return null
        val api = TokenStore.apiBase(ctx) ?: return null
        val token = TokenStore.token(ctx) ?: return null
        val out = file(ctx, code)
        val part = File(out.path + ".part")
        // Old downloads of other versions
        out.parentFile?.listFiles()?.filter { it != out && it != part }?.forEach { it.delete() }
        if (!(out.exists() && sha256(out) == sha)) {
            setStatus(ctx, "downloading", progressOf(part.length(), size))
            val req = Request.Builder().url("$api/api/updates/$TARGET/apk").header("Authorization", "Bearer $token")
                .apply { if (part.exists() && part.length() in 1 until size) header("Range", "bytes=${part.length()}-") }.build()
            try {
                client.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) { setStatus(ctx, "failed", error = "Download failed (${r.code})"); return null }
                    val append = r.code == 206
                    if (!append) part.delete()
                    FileOutputStream(part, append).use { fos ->
                        val input = r.body.byteStream()
                        val buf = ByteArray(64 * 1024)
                        var done = part.length()
                        var lastPct = -1
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            fos.write(buf, 0, n)
                            done += n
                            val pct = progressOf(done, size)
                            if (pct != lastPct) { lastPct = pct; prefs(ctx).edit().putInt("progress", pct).apply(); QuickRecorderPlugin.deliverUpdate(state(ctx)); progressNotification(ctx, latest, pct) }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.i(TAG, "Download interrupted: ${e.javaClass.simpleName}")
                setStatus(ctx, "failed", error = "Download interrupted — it resumes next time")
                return null
            }
            if (!part.renameTo(out)) { part.copyTo(out, overwrite = true); part.delete() }
        }
        val problem = verify(ctx, out, sha, code)
        if (problem != null) {
            out.delete()
            Log.w(TAG, "Rejected update: $problem")
            report(ctx, "rejected", code, latest.optString("versionName"), problem)
            setStatus(ctx, "failed", error = "Update rejected: $problem")
            cancelNotification(ctx)
            return null
        }
        setStatus(ctx, "ready", 100)
        return out
    }

    private fun progressOf(done: Long, size: Long) = if (size > 0) ((done * 100) / size).toInt().coerceIn(0, 100) else 0

    fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s -> val b = ByteArray(64 * 1024); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** null = OK; otherwise why it must not be installed */
    fun verify(ctx: Context, apk: File, sha: String, code: Int): String? {
        if (sha.isBlank() || sha256(apk) != sha.lowercase()) return "the file doesn't match its checksum"
        val pm = ctx.packageManager
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.path, flags) ?: return "not a valid app package"
        if (archive.packageName != ctx.packageName) return "it's a different app (${archive.packageName})"
        val archiveCode = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong()
        if (archiveCode != code.toLong() || archiveCode <= BuildConfig.VERSION_CODE) return "the version inside doesn't match"
        val installed = pm.getPackageInfo(ctx.packageName, flags)
        val theirs = signers(archive, current = true)
        val ours = signers(installed, current = false)
        if (theirs.isEmpty() || ours.isEmpty() || !ours.containsAll(theirs)) return "it isn't signed with the Pocket Archive key"
        return null
    }

    /** SHA-256 of the signing certificate(s): the current signers of an APK, or the installed app's lineage */
    @Suppress("DEPRECATION")
    fun signers(info: PackageInfo, current: Boolean): Set<String> {
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

    // ── Install ────────────────────────────────────────────────────────────

    /** Download if needed, verify, install. Called from the app (Update), the notification, or the worker. */
    fun update(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            setStatus(ctx, "available", error = "Allow “Install unknown apps” for Pocket Archive first")
            return
        }
        busy = true
        try {
            val apk = download(ctx) ?: return
            install(ctx, apk)
        } finally { if (prefs(ctx).getString("status", "") !in setOf("deferred", "installing")) busy = false }
    }

    fun install(ctx: Context, apk: File) {
        // Never interrupt a recording: wait for it to end
        if (RecorderState.recording) {
            busy = true
            setStatus(ctx, "deferred", 100)
            report(ctx, "deferred", latestCode(ctx), null, "recording")
            RecorderState.addStateListener(object : (Boolean) -> Unit {
                override fun invoke(recording: Boolean) {
                    if (recording) return
                    RecorderState.removeStateListener(this)
                    busy = false
                    UpdateWorker.installNow(ctx)
                }
            })
            return
        }
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(ctx.packageName)
                setSize(apk.length())
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                if (Build.VERSION.SDK_INT >= 34) setRequestUpdateOwnership(true)
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("base.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; session.fsync(out) }
                val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, UpdateInstallReceiver::class.java).putExtra("code", latestCode(ctx)),
                    PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))
                prefs(ctx).edit().putInt("installingCode", latestCode(ctx)).apply()
                setStatus(ctx, "installing", 100)
                session.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Install failed", e)
            setStatus(ctx, "failed", error = "Install failed: ${e.message}")
            report(ctx, "failed", latestCode(ctx), null, e.message)
        }
    }

    private fun latestCode(ctx: Context) = prefs(ctx).getString("latest", null)?.let { JSONObject(it).optInt("versionCode") } ?: 0

    /** At app start: did the update we started go through? (the old process was replaced, so no callback) */
    fun afterStart(ctx: Context) {
        val p = prefs(ctx)
        val code = p.getInt("installingCode", 0)
        if (code > 0 && BuildConfig.VERSION_CODE >= code) {
            p.edit().remove("installingCode").putString("status", "idle").putInt("progress", 0).apply()
            report(ctx, "installed", BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME, null)
            File(ctx.filesDir, "updates").listFiles()?.forEach { it.delete() }
            cancelNotification(ctx)
        } else if (!busy && p.getString("status", "idle") in setOf("downloading", "deferred", "installing")) {
            // Left over from a process that ended mid-way (or a declined confirm): offer it again
            p.edit().remove("installingCode").putString("status", if (latestCode(ctx) > BuildConfig.VERSION_CODE) "available" else "idle").putInt("progress", 0).apply()
        }
    }

    /** "Install unknown apps" for Pocket Archive (first time) */
    fun installSettingsIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    // ── Report (no personal data: device token, versions, event) ───────────

    fun report(ctx: Context, event: String, code: Int?, name: String?, detail: String?, target: String = TARGET) {
        val api = TokenStore.apiBase(ctx) ?: return
        val token = TokenStore.token(ctx) ?: return
        Thread {
            runCatching {
                val body = JSONObject().put("event", event).put("versionCode", code ?: 0).put("versionName", name ?: "").apply { if (detail != null) put("detail", detail) }
                client.newCall(Request.Builder().url("$api/api/updates/$target/report").header("Authorization", "Bearer $token")
                    .post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().close()
            }
        }.start()
    }

    // ── Notifications ──────────────────────────────────────────────────────

    private fun notifyAvailable(ctx: Context, latest: JSONObject) {
        Notifications.ensureChannels(ctx)
        val name = latest.optString("versionName")
        val notes = latest.optString("releaseNotes").lines().map { it.trim().removePrefix("- ") }.filter { it.isNotBlank() && !it.startsWith("#") }.take(3).joinToString("\n")
        val n = NotificationCompat.Builder(ctx, Notifications.CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Update $name available")
            .setContentText("What's new: ${notes.lineSequence().firstOrNull() ?: "improvements"}")
            .setStyle(NotificationCompat.BigTextStyle().bigText(notes))
            .setAutoCancel(true)
            .setContentIntent(Notifications.openApp(ctx, "/settings#about"))
            .addAction(0, "Update", PendingIntent.getBroadcast(ctx, 51, Intent(ctx, UpdateActionReceiver::class.java).setAction(UpdateActionReceiver.UPDATE), PendingIntent.FLAG_IMMUTABLE))
            .addAction(0, "Later", PendingIntent.getBroadcast(ctx, 52, Intent(ctx, UpdateActionReceiver::class.java).setAction(UpdateActionReceiver.LATER), PendingIntent.FLAG_IMMUTABLE))
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_UPDATE, n) } catch (_: SecurityException) { /* notifications off */ }
    }

    private fun progressNotification(ctx: Context, latest: JSONObject, pct: Int) {
        val n = NotificationCompat.Builder(ctx, Notifications.CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Downloading update ${latest.optString("versionName")}")
            .setProgress(100, pct, false)
            .setOngoing(pct < 100)
            .setOnlyAlertOnce(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_UPDATE, n) } catch (_: SecurityException) { /* notifications off */ }
    }

    fun confirmNotification(ctx: Context, confirm: Intent) {
        val n = NotificationCompat.Builder(ctx, Notifications.CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(Notifications.BRAND)
            .setContentTitle("Tap to finish updating Pocket Archive")
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(ctx, 53, confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID_UPDATE, n) } catch (_: SecurityException) { /* notifications off */ }
    }

    fun cancelNotification(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_UPDATE)

    // ── Schedule ───────────────────────────────────────────────────────────

    fun schedule(ctx: Context, replace: Boolean = false) {
        val wifiOnly = prefs(ctx).getBoolean("wifiOnly", true)
        val request = PeriodicWorkRequestBuilder<UpdateWorker>(1, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED).build())
            .setInputData(workDataOf("action" to "check"))
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("app-update-daily",if (replace) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

/** Daily check / "Update" (download + verify + install) off the main thread */
class UpdateWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        when (inputData.getString("action")) {
            "check" -> AppUpdater.check(applicationContext, manual = false)
            "update" -> AppUpdater.update(applicationContext)
            "install" -> AppUpdater.download(applicationContext)?.let { AppUpdater.install(applicationContext, it) }
            "watch" -> WatchUpdateRelay.relay(applicationContext)
        }
        return Result.success()
    }

    companion object {
        private fun run(ctx: Context, action: String, network: Boolean) {
            val req = OneTimeWorkRequestBuilder<UpdateWorker>().setInputData(workDataOf("action" to action))
                .apply { if (network) setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()) }
                .build()
            // "-now-": never the periodic "app-update-daily" (REPLACE on the same name would cancel the daily check)
            WorkManager.getInstance(ctx).enqueueUniqueWork("app-update-now-$action", ExistingWorkPolicy.REPLACE, req)
        }
        fun checkNow(ctx: Context) = run(ctx, "check", true)
        fun updateNow(ctx: Context) = run(ctx, "update", true)
        fun installNow(ctx: Context) = run(ctx, "install", false)
        fun relayToWatch(ctx: Context) = run(ctx, "watch", true)
    }
}

/** Update / Later on the notification */
class UpdateActionReceiver : BroadcastReceiver() {
    companion object { const val UPDATE = "com.sanpan003.pocketarchive.UPDATE_NOW"; const val LATER = "com.sanpan003.pocketarchive.UPDATE_LATER" }
    override fun onReceive(ctx: Context, intent: Intent) {
        AppUpdater.cancelNotification(ctx)
        if (intent.action == UPDATE) UpdateWorker.updateNow(ctx)
    }
}

/** PackageInstaller result */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val code = intent.getIntExtra("code", 0)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                // Android's confirm dialog: straight away when the app is on screen, else a notification to tap
                if (QuickRecorderPlugin.isAppVisible()) {
                    try { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { /* fall through */ }
                }
                AppUpdater.confirmNotification(ctx, confirm)
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.afterStart(ctx)
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status"
                Log.w("AppUpdater", "Install failed: $msg")
                ctx.getSharedPreferences("app_update", Context.MODE_PRIVATE).edit().putString("status", if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "available" else "failed")
                    .putString("error", when {
                        status == PackageInstaller.STATUS_FAILURE_ABORTED -> null
                        // Google Play Protect's "scan this app?" dialog was dismissed or timed out
                        msg.contains("VERIFICATION", ignoreCase = true) -> "Play Protect stopped the install. Tap Update again and, if Play Protect asks, choose Install anyway (or Scan app)."
                        else -> "Install failed: $msg"
                    }).remove("installingCode").apply()
                AppUpdater.report(ctx, if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "declined" else "failed", code, null, msg)
                QuickRecorderPlugin.deliverUpdate(AppUpdater.state(ctx))
            }
        }
    }
}
