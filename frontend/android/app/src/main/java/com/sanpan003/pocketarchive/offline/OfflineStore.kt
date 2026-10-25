package com.sanpan003.pocketarchive.offline

import android.content.Context
import android.net.ConnectivityManager
import android.util.Log
import android.webkit.WebResourceResponse
import com.sanpan003.pocketarchive.quick.TokenStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * The offline copy (2.9.0): one encrypted database + encrypted media folder per phone, for the signed-in user only
 * (another user signing in, signing out, or the device being revoked wipes it). Opened with OfflineKeys — so not
 * while the app is locked. Used by the Offline plugin (the web layer), OfflineWorker (background), the app shell
 * (media for the screens) and the widget.
 */
object OfflineStore {
    private const val TAG = "Offline"
    private var data: SqlCipherData? = null
    private var vault: MediaVault? = null
    @Volatile var syncing = false
        private set
    @Volatile private var lastProgress: JSONObject? = null
    private val listeners = mutableListOf<(String, JSONObject) -> Unit>()

    fun onEvent(fn: (String, JSONObject) -> Unit) = synchronized(listeners) { listeners += fn }
    fun emit(event: String, payload: JSONObject) = synchronized(listeners) { listeners.toList() }.forEach { runCatching { it(event, payload) } }

    private fun dir(ctx: Context) = File(ctx.noBackupFilesDir, "offline")

    /** The copy, or null (signed out, locked, or switched off by "Delete offline data") */
    @Synchronized
    fun open(ctx: Context): SqlCipherData? {
        val userId = TokenStore.userId(ctx)
        if (userId == null || !TokenStore.signedIn(ctx)) { close(); return null }
        when (val k = OfflineKeys.get(ctx)) {
            is OfflineKeys.Result.Locked -> { close(); return null }
            is OfflineKeys.Result.Lost -> {
                Log.i(TAG, "Key can't be opened any more (fingerprints changed?): starting a new copy")
                wipeFiles(ctx); OfflineKeys.reset(ctx)
                return open(ctx)
            }
            is OfflineKeys.Result.Key -> {
                if (data == null) {
                    if (k.fresh) wipeFiles(ctx)
                    val d = try { SqlCipherData.open(File(dir(ctx), "copy.db"), k.key) } catch (e: Exception) {
                        Log.w(TAG, "Can't open the copy: ${e.javaClass.simpleName} — starting over")
                        wipeFiles(ctx); OfflineKeys.reset(ctx); return null
                    }
                    val mediaKey = d.meta("mediaKey")?.let { android.util.Base64.decode(it, android.util.Base64.NO_WRAP) }
                        ?: ByteArray(32).also { SecureRandom().nextBytes(it); d.setMeta("mediaKey", android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP)) }
                    vault = MediaVault(File(dir(ctx), "media"), mediaKey)
                    data = d
                }
                val d = data!!
                // Only ever one account's data on the phone
                if (d.meta("userId") != userId) {
                    if (d.meta("userId") != null) { d.clearAll(); vault?.deleteAll() }
                    d.setMeta("userId", userId)
                }
                return d
            }
        }
    }

    @Synchronized
    fun close() {
        data?.close(); data = null; vault = null
    }

    fun vault(ctx: Context): MediaVault? { open(ctx); return vault }

    private fun wipeFiles(ctx: Context) {
        close()
        dir(ctx).deleteRecursively()
    }

    /** Sign out, account switch, revoked device, "Delete offline data": nothing of the account stays here */
    @Synchronized
    fun wipe(ctx: Context, reason: String) {
        Log.i(TAG, "Offline copy deleted ($reason)")
        wipeFiles(ctx)
        OfflineKeys.reset(ctx)
        lastProgress = null
        if (reason == "user") setSettingsPref(ctx, settings(ctx).copy(enabled = false))
        if (reason != "user") settingsPrefs(ctx).edit().clear().apply()
        emit("changed", JSONObject())
        emit("status", status(ctx))
    }

    // ── Settings (not secret: what to keep, limits — kept outside the copy so they show while locked) ──
    private fun settingsPrefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("offline_settings", Context.MODE_PRIVATE)
    fun settings(ctx: Context): OfflineSettings =
        OfflineSettings.fromJson(settingsPrefs(ctx).getString("s", null)?.let { runCatching { JSONObject(it) }.getOrNull() })
    private fun setSettingsPref(ctx: Context, s: OfflineSettings) = settingsPrefs(ctx).edit().putString("s", s.toJson().toString()).apply()
    fun setSettings(ctx: Context, s: OfflineSettings) {
        setSettingsPref(ctx, s)
        open(ctx)?.let { d -> engine(ctx, d)?.planMedia() }
        emit("status", status(ctx))
    }

    fun unmetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
        return !cm.isActiveNetworkMetered
    }

    fun isAdmin(d: OfflineData): Boolean = d.getKv("/auth/me")?.let { runCatching { JSONObject(it).optString("role") == "admin" }.getOrNull() } == true

    private fun engine(ctx: Context, d: SqlCipherData): SyncEngine? {
        val api = TokenStore.apiBase(ctx) ?: return null
        val token = TokenStore.token(ctx) ?: return null
        return SyncEngine(d, OkRemote(api, token), vault, { settings(ctx) }, { unmetered(ctx) }, { isAdmin(d) }, { e, p ->
            when (e) {
                "progress" -> { lastProgress = p; emit("status", status(ctx)) }
                else -> emit(e, p)
            }
        })
    }

    /** One round: replay, text, archive, media (until deadline). Returns why it stopped. */
    fun runSync(ctx: Context, reason: String, deadline: Long): SyncEngine.Stop? {
        if (syncing) return null
        val s = settings(ctx)
        if (!s.enabled && reason != "user") return null
        if (!s.enabled) setSettingsPref(ctx, s.copy(enabled = true))
        val d = open(ctx) ?: return null
        val api = TokenStore.apiBase(ctx)
        if (!NasProbe.check(api, maxAgeMs = if (reason == "background") 0 else 5_000)) { emit("status", status(ctx)); return SyncEngine.Stop.NETWORK }
        val e = engine(ctx, d) ?: return null
        syncing = true
        emit("status", status(ctx))
        val stop = try { e.run(deadline) } catch (ex: Exception) {
            Log.w(TAG, "Sync stopped: ${ex.javaClass.simpleName}"); SyncEngine.Stop.NETWORK
        } finally { syncing = false }
        lastProgress = e.progress()
        when (stop) {
            SyncEngine.Stop.SIGNED_OUT -> wipe(ctx, "revoked")   // device revoked / signed out elsewhere: wipe at this contact
            SyncEngine.Stop.NETWORK -> NasProbe.forget()
            else -> Unit
        }
        emit("status", status(ctx))
        return stop
    }

    // ── Status for the screens ──────────────────────────────────────────────
    fun status(ctx: Context): JSONObject {
        val s = settings(ctx)
        val o = JSONObject().put("available", true).put("enabled", s.enabled).put("online", NasProbe.reachable ?: true)
            .put("syncing", syncing).put("settings", s.toJson().put("lockProtected", com.sanpan003.pocketarchive.quick.AppLock.enabled(ctx)))
        val d = runCatching { open(ctx) }.getOrNull()
        if (d == null) return o.put("open", false).put("locked", com.sanpan003.pocketarchive.quick.AppLock.isLocked(ctx)).put("pending", 0).put("conflicts", 0)
        val usage = JSONObject().put("text", d.textBytes())
        for (k in listOf("photo", "scan", "file", "audio", "thumb", "recording", "map")) usage.put(k, 0L)
        for (r in d.allMedia()) if (r.state == "have" || r.state == "partial") {
            val k = if (usage.has(r.kind)) r.kind else "file"
            usage.put(k, usage.getLong(k) + MediaVault.storedSize(if (r.state == "have") r.size else r.done))
        }
        return o.put("open", true).put("locked", false).put("pending", d.queue().size).put("conflicts", d.countConflicts())
            .put("lastSyncAt", d.meta("lastSyncAt") ?: JSONObject.NULL).put("progress", lastProgress ?: JSONObject.NULL).put("usage", usage)
    }

    // ── Media for the screens (the app shell asks for every /api/… GET) ────────
    private val MEDIA = Regex("^/api/(quick/qn_[\\w-]+/(media|audio|attachments/[\\w-]+(/thumb|/pages/[\\w-]+(/thumb)?)?)|audio/.+|recordings/[^/]+/attachments/.+|maps/.+)$")
    fun isMediaPath(path: String) = MEDIA.matches(path)

    /** A kept file as a response (Range → 206), or null to let the request go to the NAS */
    fun mediaResponse(ctx: Context, path: String, v: String?, headers: Map<String, String>?): WebResourceResponse? {
        if (!isMediaPath(path)) return null
        val d = open(ctx) ?: return null
        val vt = vault ?: return null
        val row = d.media(path) ?: d.media(android.net.Uri.decode(path)) ?: return null
        if (row.state != "have" || (v != null && row.v != null && v != row.v) || !vt.exists(row.file)) return null
        d.putMedia(row.copy(lastUsed = System.currentTimeMillis()))
        val total = row.size
        val range = (headers?.get("Range") ?: headers?.get("range"))?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
        val mime = row.mime?.substringBefore(';') ?: "application/octet-stream"
        val base = mapOf("Accept-Ranges" to "bytes", "Cache-Control" to "no-store", "Access-Control-Allow-Origin" to "*")
        if (range != null && total > 0) {
            val from = range.groupValues[1].toLongOrNull() ?: 0L
            val to = (range.groupValues[2].toLongOrNull() ?: (total - 1)).coerceAtMost(total - 1)
            if (from >= total || from > to) return WebResourceResponse(mime, null, 416, "Range Not Satisfiable", base + ("Content-Range" to "bytes */$total"), null)
            return WebResourceResponse(mime, null, 206, "Partial Content",
                base + mapOf("Content-Range" to "bytes $from-$to/$total", "Content-Length" to (to - from + 1).toString()), vt.open(row.file, total, from, to))
        }
        return WebResourceResponse(mime, null, 200, "OK", base + ("Content-Length" to total.toString()), vt.open(row.file, total))
    }

    /** A picture taken offline, shown at once under the URL the screens use */
    fun putMedia(ctx: Context, key: String, bytes: ByteArray, type: String) {
        val d = open(ctx) ?: return
        val vt = vault ?: return
        val row = MediaRow(key, null, if (type.startsWith("image/")) "photo" else "file", bytes.size.toLong(),
            noteId = Regex("/quick/(qn_[\\w-]+)").find(key)?.groupValues?.get(1), state = "have", done = bytes.size.toLong(), mime = type)
        vt.writer(row.file).use { it.write(bytes); it.finish() }
        d.putMedia(row)
    }

    /** "Free up space": remove photos, scans and audio; keep every note (switches to Text only) */
    fun freeUpSpace(ctx: Context) {
        setSettingsPref(ctx, settings(ctx).copy(mode = "text"))
        val d = open(ctx) ?: return
        val vt = vault
        d.tx { for (r in d.allMedia()) { vt?.delete(r.file); d.putMedia(r.copy(state = "skip", done = 0)) } }
        emit("status", status(ctx))
    }

    fun failed(ctx: Context): JSONArray = open(ctx)?.failed() ?: JSONArray()
}
