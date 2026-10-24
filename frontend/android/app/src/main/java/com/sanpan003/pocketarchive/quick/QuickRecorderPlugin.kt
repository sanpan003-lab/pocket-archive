package com.sanpan003.pocketarchive.quick

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning

/**
 * Bridge between the web app and the native recorder, secure token storage,
 * and launch routes. Events: state, level, result, queued, empty, error,
 * pending, navigate.
 */
@CapacitorPlugin(
    name = "QuickRecorder",
    permissions = [
        Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "backgroundLocation", strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]),
        Permission(alias = "contacts", strings = [Manifest.permission.READ_CONTACTS]),
    ],
)
class QuickRecorderPlugin : Plugin() {

    companion object {
        @Volatile private var instance: QuickRecorderPlugin? = null
        @Volatile private var appVisible = false
        @Volatile private var pendingRoute: String? = null

        /** The app's screens are in front (background checks stay quiet then) */
        fun isAppVisible() = appVisible
        private val main = Handler(Looper.getMainLooper())

        /**
         * Send an event to the web layer. Returns true when the app is on
         * screen and listening, i.e. it will show its own toast.
         */
        fun deliverToApp(event: String, data: JSObject): Boolean =
            instance?.deliver(event, data) ?: false

        /** Ask the app to open a route (cold start: picked up via getLaunchRoute). */
        fun navigate(route: String) {
            pendingRoute = route
            main.post { instance?.deliver("navigate", JSObject().put("route", route)) }
        }

        /** getToken calls from the web layer waiting for the app lock */
        private val waitingForUnlock = mutableListOf<PluginCall>()

        /** The lock screen was passed: the web layer gets its token, and the syncs that read notes can run */
        fun onUnlocked(ctx: Context, token: String) {
            val calls = synchronized(waitingForUnlock) { waitingForUnlock.toList().also { waitingForUnlock.clear() } }
            calls.forEach { it.resolve(JSObject().put("token", token)) }
            instance?.deliver("unlocked", JSObject())
            ErrandWorker.syncNow(ctx)
            WidgetData.refreshAsync(ctx)
            QuickToggleWidget.updateAll(ctx)
        }

        /** Over-the-air update state changed (banner, Settings → About) */
        fun deliverUpdate(state: JSONObject) {
            main.post { instance?.deliver("update", JSObject.fromJSONObject(state)) }
        }

        fun notifyPending(ctx: Context) {
            instance?.deliver("pending", JSObject().put("count", PendingStore.count(ctx)))
        }

        /** Settings → Recording & shortcuts → Test: volume keys are reported, not used */
        @Volatile var keyTestActive = false
            private set

        fun reportKey(keyCode: Int, long: Boolean) {
            val key = if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) "volumeUp" else "volumeDown"
            main.post {
                instance?.deliver("keyTest", JSObject()
                    .put("key", key).put("long", long)
                    .put("recording", RecorderState.recording)
                    .put("at", System.currentTimeMillis()))
            }
        }
    }

    private val stateListener: (Boolean) -> Unit = { recording ->
        deliver("state", stateJson().put("recording", recording))
    }
    private var lastLevelAt = 0L
    private val levelListener: (Double) -> Unit = { level ->
        val now = System.currentTimeMillis()
        if (appVisible && now - lastLevelAt >= 45) { // ~20/s for the capture screen waveform
            lastLevelAt = now
            deliver("level", JSObject().put("level", level))
        }
    }

    /** Document scanner (ML Kit) + system camera: registered while the activity is being created */
    private var scanLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    private var onScan: ((Int, Intent?) -> Unit)? = null
    private var cameraLauncher: ActivityResultLauncher<android.net.Uri>? = null
    private var onPhoto: ((Boolean) -> Unit)? = null

    override fun load() {
        instance = this
        scanLauncher = runCatching {
            activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r -> val cb = onScan; onScan = null; cb?.invoke(r.resultCode, r.data) }
        }.getOrNull()
        cameraLauncher = runCatching {
            activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { ok -> val cb = onPhoto; onPhoto = null; cb?.invoke(ok) }
        }.getOrNull()
        Notifications.ensureChannels(context)
        PendingStore.recoverOrphans(context)
        RecorderState.addStateListener(stateListener)
        RecorderState.addLevelListener(levelListener)
        if (TokenStore.token(context) != null) {
            ErrandWorker.schedulePeriodic(context)
            ErrandWorker.syncNow(context)
            ChangesWorker.schedule(context)
            // Over-the-air updates: finish a just-installed update, check on open + daily
            AppUpdater.afterStart(context)
            AppUpdater.schedule(context)
            UpdateWorker.checkNow(context)
        }
    }

    override fun handleOnResume() {
        appVisible = true
        deliver("state", stateJson())
        if (QuickToggleWidget.hasWidgets(context)) {
            WidgetRefreshWorker.schedulePeriodic(context)
            WidgetData.refreshAsync(context)
        }
        if (TokenStore.token(context) != null) ErrandWorker.syncNow(context)
    }

    override fun handleOnPause() {
        appVisible = false
        keyTestActive = false // never keep the keys once the screen is left
    }

    override fun handleOnDestroy() {
        RecorderState.removeStateListener(stateListener)
        RecorderState.removeLevelListener(levelListener)
        if (instance === this) instance = null
    }

    private fun deliver(event: String, data: JSObject): Boolean {
        val listening = hasListeners(event)
        notifyListeners(event, data)
        return appVisible && listening
    }

    private fun stateJson() = JSObject().apply {
        put("recording", RecorderState.recording)
        put("startedAt", RecorderState.startedAt)
        put("pendingUploads", PendingStore.count(context))
    }

    // ── Recording ──────────────────────────────────────────────────────────

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startAfterPermission")
            return
        }
        startRecording(call)
    }

    @PermissionCallback
    private fun startAfterPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startRecording(call)
        else call.reject("Microphone permission denied", "MIC_DENIED")
    }

    private fun startRecording(call: PluginCall) {
        when (QuickActions.blocker(context)) {
            "signin" -> return call.reject("Sign in first", "NO_TOKEN")
            "mic" -> return call.reject("Microphone permission denied", "MIC_DENIED")
        }
        QuickActions.start(context, "app")
        call.resolve(stateJson().put("recording", true))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        QuickActions.stop(context)
        call.resolve(stateJson())
    }

    @PluginMethod
    fun getState(call: PluginCall) = call.resolve(stateJson())

    // ── Settings & secure token storage ────────────────────────────────────

    /**
     * { apiBase, feedback, volumeStop, launcherToggle } — server URL for native uploads,
     * "Sound & vibration", "Volume down stops recording", "Quick Record stops a recording".
     */
    @PluginMethod
    fun configure(call: PluginCall) {
        call.getString("apiBase")?.let { TokenStore.setApiBase(context, it) }
        call.getBoolean("feedback")?.let { TokenStore.setFeedbackEnabled(context, it) }
        call.getBoolean("volumeStop")?.let { TokenStore.setVolumeStop(context, it) }
        call.getBoolean("launcherToggle")?.let { TokenStore.setLauncherToggle(context, it) }
        call.resolve()
    }

    @PluginMethod
    fun setToken(call: PluginCall) {
        switchUser(call.getString("userId"))
        TokenStore.setToken(context, call.getString("token"))
        UploadWorker.retryAllNow(context) // anything waiting on sign-in goes now
        DocUploadWorker.enqueue(context)     // queued scans / photos of this user too
        WidgetData.refreshAsync(context)
        ErrandWorker.schedulePeriodic(context)
        ErrandWorker.syncNow(context)
        ChangesWorker.schedule(context)
        WearBridge.async { WearBridge.sendToken(context) } // the watch's direct-upload fallback
        call.resolve()
    }

    /** "Restore" on the in-app toast (the newest) or in the Accidental recordings log ({ name }) */
    @PluginMethod
    fun restoreIgnored(call: PluginCall) {
        val name = call.getString("name")
        call.resolve(JSObject().put("restored", if (name.isNullOrBlank()) AccidentalStore.restoreLatest(context) else AccidentalStore.restore(context, name)))
    }

    /** Recordings set aside in the last 30 s that can still be restored: { kept: [{ name, until }] } */
    @PluginMethod
    fun getIgnored(call: PluginCall) {
        val arr = JSArray()
        for ((name, until) in AccidentalStore.kept(context)) arr.put(JSObject().put("name", name).put("until", until))
        call.resolve(JSObject().put("kept", arr))
    }

    // ── Over-the-air updates (Settings → About, banner) ──────────────────────

    @PluginMethod
    fun getUpdateState(call: PluginCall) = call.resolve(JSObject.fromJSONObject(AppUpdater.state(context)))

    /** "Check for updates" */
    @PluginMethod
    fun checkForUpdates(call: PluginCall) {
        Thread { val s = AppUpdater.check(context, manual = true); main.post { call.resolve(JSObject.fromJSONObject(s)) } }.start()
    }

    /** "Update": download (progress events), verify, install */
    @PluginMethod
    fun startUpdate(call: PluginCall) {
        UpdateWorker.updateNow(context)
        call.resolve(JSObject.fromJSONObject(AppUpdater.state(context)))
    }

    /** { wifiOnly } */
    @PluginMethod
    fun setUpdateSettings(call: PluginCall) {
        call.getBoolean("wifiOnly")?.let { AppUpdater.setWifiOnly(context, it) }
        call.resolve(JSObject.fromJSONObject(AppUpdater.state(context)))
    }

    /** First time: Android → "Install unknown apps" → allow for Pocket Archive */
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        activity.startActivity(AppUpdater.installSettingsIntent(context))
        call.resolve()
    }

    /** "Update watch" */
    @PluginMethod
    fun updateWatch(call: PluginCall) {
        WatchUpdateRelay.updateNow(context)
        call.resolve()
    }

    // ── Attachments on notes ────────────────────────────────────────────────

    /** Open the ML Kit scanner; [then] gets the page images (call rejected when cancelled) */
    private fun startScan(call: PluginCall, pageLimit: Int, then: (List<android.net.Uri>) -> Unit) {
        val launcher = scanLauncher ?: return call.reject("The scanner isn't available on this phone")
        if (onScan != null) return call.reject("The scanner is already open")
        GmsDocumentScanning.getClient(DocCapture.scannerOptions(pageLimit)).getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                onScan = { code, data ->
                    val pages = if (code == android.app.Activity.RESULT_OK) DocCapture.pagesOf(data) else emptyList()
                    if (pages.isEmpty()) call.reject("Cancelled", "CANCELLED") else then(pages)
                }
                launcher.launch(IntentSenderRequest.Builder(sender).build())
            }
            .addOnFailureListener { e -> call.reject("The scanner couldn't start: ${e.message ?: "Google Play services needed"}") }
    }

    /**
     * Scan straight into a note: { path, method?, partName?, pageLimit?, fields? } — the pages are uploaded to
     * our own server (path must be a note's attachments / pages route) and the server's answer (the note) returned.
     */
    @PluginMethod
    fun scanUpload(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path?")
        if (!Regex("^/api/quick/qn_[\\w-]+/attachments(/at_[a-z0-9]+/pages(/pg_[a-z0-9]+/content)?)?$").matches(path)) return call.reject("Not an attachments route")
        val method = if (call.getString("method") == "PUT") "PUT" else "POST"
        val part = if (call.getString("partName") == "file") "file" else "page"
        val fields = call.getObject("fields") ?: JSObject()
        startScan(call, call.getInt("pageLimit") ?: 30) { pages ->
            Thread {
                try {
                    val out = NoteFiles.uploadPages(context, path, method, part, pages, fields)
                    main.post { call.resolve(JSObject.fromJSONObject(out)) }
                } catch (e: Exception) {
                    main.post { call.reject(e.message ?: "The scan couldn't be uploaded") }
                }
            }.start()
        }
    }

    /**
     * Create menu → Scan document / Camera: a NEW note. The capture goes into the offline queue first, then
     * up right away when there's a connection → { note, confirmation } | { queued: true }.
     */
    @PluginMethod
    fun captureDocument(call: PluginCall) {
        val user = TokenStore.userId(context) ?: return call.reject("Sign in first")
        val kind = if (call.getString("kind") == "camera") "camera" else "scan"
        val afterCapture: (List<android.net.Uri>, java.io.File?) -> Unit = { pages, photo ->
            Thread {
                try {
                    val item = DocQueue.add(context, user, kind, pages, photo)
                    when (val outcome = DocQueue.upload(context, item)) {
                        is UploadOutcome.Sent -> { DocQueue.remove(item); main.post { call.resolve(JSObject.fromJSONObject(outcome.response)) } }
                        is UploadOutcome.Retry -> { DocUploadWorker.enqueue(context); main.post { call.resolve(JSObject().put("queued", true).put("reason", outcome.reason)) } }
                        is UploadOutcome.Failed -> { DocQueue.remove(item); main.post { call.reject(outcome.reason) } }
                    }
                } catch (e: Exception) {
                    main.post { call.reject(e.message ?: "Couldn't save it") }
                }
            }.start()
        }
        if (kind == "scan") { startScan(call, 30) { pages -> afterCapture(pages, null) }; return }
        val launcher = cameraLauncher ?: return call.reject("The camera isn't available")
        if (onPhoto != null) return call.reject("The camera is already open")
        val (file, uri) = DocCapture.cameraTarget(context)
        onPhoto = { ok -> if (ok && file.length() > 0) afterCapture(emptyList(), file) else { file.delete(); call.reject("Cancelled", "CANCELLED") } }
        try { launcher.launch(uri) } catch (e: Exception) { onPhoto = null; call.reject("No camera app") }
    }

    /** Business card → Android's Contacts editor, prefilled (the user taps Save there) */
    @PluginMethod
    fun saveContact(call: PluginCall) {
        val i = Intent(android.provider.ContactsContract.Intents.Insert.ACTION).setType(android.provider.ContactsContract.RawContacts.CONTENT_TYPE)
        call.getString("name")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.NAME, it) }
        call.getString("company")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.COMPANY, it) }
        call.getString("jobTitle")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.JOB_TITLE, it) }
        call.getString("phone")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.PHONE, it) }
        call.getString("email")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.EMAIL, it) }
        call.getString("address")?.takeIf { it.isNotBlank() }?.let { i.putExtra(android.provider.ContactsContract.Intents.Insert.POSTAL, it) }
        call.getString("website")?.takeIf { it.isNotBlank() }?.let { site ->
            val row = android.content.ContentValues().apply {
                put(android.provider.ContactsContract.Data.MIMETYPE, android.provider.ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE)
                put(android.provider.ContactsContract.CommonDataKinds.Website.URL, site)
            }
            i.putParcelableArrayListExtra(android.provider.ContactsContract.Intents.Insert.DATA, arrayListOf(row))
        }
        try { activity.startActivity(i); call.resolve() } catch (e: Exception) { call.reject("No contacts app") }
    }

    /** Open an attachment in the app Android picks for it: { url, name, mime } */
    @PluginMethod
    fun openFile(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url?")
        val name = call.getString("name") ?: "attachment"
        val mime = call.getString("mime") ?: "*/*"
        Thread {
            try {
                NoteFiles.open(context, url, name, mime)
                main.post { call.resolve() }
            } catch (e: Exception) {
                main.post { call.reject(e.message ?: "Couldn't open it") }
            }
        }.start()
    }

    // ── Phone actions (Quick Capture → Actions) ──────────────────────────────

    /** { action, choice? } → { status, icon, text, detail?, undo } (also reported to the server) */
    @PluginMethod
    fun runPhoneAction(call: PluginCall) {
        val action = call.getObject("action") ?: return call.reject("action is required")
        val choice = call.getObject("choice")
        main.post { call.resolve(JSObject.fromJSONObject(PhoneActions.run(context, action, choice))) }
    }

    @PluginMethod
    fun undoPhoneAction(call: PluginCall) {
        val action = call.getObject("action") ?: return call.reject("action is required")
        main.post { call.resolve(JSObject.fromJSONObject(PhoneActions.undo(context, action))) }
    }

    /** Contacts matching a name; asks for the contacts permission the first time it's needed */
    @PluginMethod
    fun findContacts(call: PluginCall) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsResult")
            return
        }
        call.resolve(JSObject().put("permission", "granted").put("choices", PhoneActions.contactsOf(context, call.getString("name") ?: "")))
    }

    @PermissionCallback
    private fun contactsResult(call: PluginCall) {
        val granted = getPermissionState("contacts") == PermissionState.GRANTED
        call.resolve(JSObject().put("permission", if (granted) "granted" else "denied")
            .put("choices", if (granted) PhoneActions.contactsOf(context, call.getString("name") ?: "") else com.getcapacitor.JSArray()))
    }

    @PluginMethod
    fun findApps(call: PluginCall) = call.resolve(JSObject().put("choices", PhoneActions.appsOf(context, call.getString("name") ?: "")))

    @PluginMethod
    fun getActionStatus(call: PluginCall) = call.resolve(JSObject.fromJSONObject(PhoneActions.status(context)))

    /** Fix-it buttons: overlay (run actions from the background) | dnd | contacts */
    @PluginMethod
    fun openActionSetup(call: PluginCall) {
        when (call.getString("target")) {
            "contacts" -> if (getPermissionState("contacts") != PermissionState.GRANTED) { requestPermissionForAlias("contacts", call, "setupContactsResult"); return }
            "dnd" -> activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
            "overlay" -> activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")))
        }
        call.resolve()
    }

    @PermissionCallback
    private fun setupContactsResult(call: PluginCall) = call.resolve()

    /** Someone changed a shared list while the app is open (live event) → redraw the widget now */
    @PluginMethod
    fun refreshWidget(call: PluginCall) {
        if (QuickToggleWidget.hasWidgets(context)) WidgetData.refreshAsync(context)
        call.resolve()
    }

    /** Settings → Shared lists → "Check now" (and tests): run the background check once */
    @PluginMethod
    fun checkSharedChanges(call: PluginCall) {
        ChangesWorker.runNow(context, (call.getInt("delayMs") ?: 0).toLong().coerceIn(0, 60_000))
        call.resolve()
    }

    /** Which user the stored token belongs to (tokens from before accounts learn it here). */
    @PluginMethod
    fun setUser(call: PluginCall) {
        val userId = call.getString("userId")?.takeIf { it.startsWith("u_") } ?: return call.reject("userId is required")
        if (TokenStore.userId(context) != userId) {
            switchUser(userId)
            UploadWorker.retryAllNow(context)
            DocUploadWorker.enqueue(context)
            ErrandWorker.syncNow(context)
            WearBridge.async { WearBridge.sendToken(context) }
        }
        call.resolve()
    }

    /**
     * Accounts: a different user on this phone → clear the previous user's widget list, errands
     * and geofences, park their queued recordings, and bring back the new user's parked ones.
     */
    private fun switchUser(userId: String?) {
        val ctx = context
        val previous = TokenStore.userId(ctx) ?: TokenStore.lastUserId(ctx)
        if (userId != null && previous != null && previous != userId) {
            PendingStore.hold(ctx, previous)
            WidgetData.clear(ctx)
            ErrandSync.clear(ctx)
            android.util.Log.i("Accounts", "Switched user on this phone; the previous user's data was cleared")
        }
        if (userId != null) {
            TokenStore.setUserId(ctx, userId)
            PendingStore.release(ctx, userId)
        }
    }

    @PluginMethod
    fun getToken(call: PluginCall) {
        // App lock: the web layer (which reads notes) only gets the full token after the fingerprint
        if (AppLock.isLocked(context)) {
            synchronized(waitingForUnlock) { waitingForUnlock += call }
            return
        }
        call.resolve(JSObject().put("token", TokenStore.token(context)))
    }

    // ── App lock (Settings → Security → "Lock app with fingerprint") ─────────

    private fun lockState(): JSObject = JSObject()
        .put("available", true)
        .put("biometrics", AppLock.availability(context))
        .put("enabled", AppLock.enabled(context))
        .put("timeoutMin", AppLock.timeoutMin(context))
        .put("secure", AppLock.secure(context))
        .put("locked", AppLock.isLocked(context))

    @PluginMethod
    fun getAppLock(call: PluginCall) = call.resolve(lockState())

    /** { enabled?, timeoutMin?, secure? } — turning it on or off asks for the fingerprint / PIN */
    @PluginMethod
    fun setAppLock(call: PluginCall) {
        val act = activity ?: return call.reject("Open the app first")
        call.getInt("timeoutMin")?.let { AppLock.setTimeout(context, it) }
        call.getBoolean("secure")?.let { AppLock.setSecure(context, it); LockScreen.applySecure(act) }
        val want = call.getBoolean("enabled") ?: return call.resolve(lockState())
        if (want == AppLock.enabled(context)) return call.resolve(lockState())
        if (want) turnOn(call, act) else turnOff(call, act)
    }

    private fun turnOn(call: PluginCall, act: androidx.fragment.app.FragmentActivity) {
        when (AppLock.availability(context)) {
            "none-enrolled" -> return call.reject("Set up a fingerprint or a screen lock in Android Settings first")
            "no-hardware" -> return call.reject("This phone has no fingerprint or screen lock")
        }
        val full = TokenStore.plainToken(context) ?: return call.reject("Sign in first")
        Thread {
            val capture = try { AppLockServer.captureToken(context, full) } catch (e: Exception) {
                main.post { call.reject(e.message ?: "Couldn’t reach your server") }
                return@Thread
            }
            main.post {
                AppLock.prompt(act, "Turn on app lock", "Use your fingerprint or your phone’s PIN", onOk = {
                    try {
                        AppLock.storeFull(context, full)          // behind the fingerprint key
                        TokenStore.setCaptureToken(context, capture)
                        AppLock.markEnabled(context, true)
                        TokenStore.setPlain(context, null)         // the full token is no longer stored openly
                        LockScreen.applySecure(act)
                        WearBridge.async { WearBridge.sendToken(context) } // the watch gets the capture-only token
                        call.resolve(lockState())
                    } catch (e: Exception) {
                        android.util.Log.w("AppLock", "Turning on failed", e)
                        AppLock.reset(context)
                        TokenStore.setPlain(context, full)
                        TokenStore.setCaptureToken(context, null)
                        Thread { AppLockServer.revokeCapture(context, full) }.start()
                        call.reject("Couldn’t turn on the app lock — try again")
                    }
                }, onFail = { msg ->
                    Thread { AppLockServer.revokeCapture(context, full) }.start()
                    call.reject(msg ?: "Cancelled", if (msg == null) "CANCELLED" else null)
                })
            }
        }.start()
    }

    private fun turnOff(call: PluginCall, act: androidx.fragment.app.FragmentActivity) {
        AppLock.prompt(act, "Turn off app lock", null, onOk = {
            val full = try { AppLock.unlockedToken(context) ?: AppLock.unlock(context) } catch (e: Exception) {
                return@prompt call.reject("Unlock the app first (your fingerprints may have changed)")
            }
            TokenStore.setPlain(context, full)
            TokenStore.setCaptureToken(context, null)
            AppLock.reset(context)
            LockScreen.applySecure(act)
            Thread { AppLockServer.revokeCapture(context, full) }.start()
            WearBridge.async { WearBridge.sendToken(context) }
            call.resolve(lockState())
        }, onFail = { msg -> call.reject(msg ?: "Cancelled", if (msg == null) "CANCELLED" else null) })
    }

    @PluginMethod
    fun clearToken(call: PluginCall) {
        // This user's queued recordings wait for them (the next person to sign in won't upload them)
        TokenStore.userId(context)?.let { PendingStore.hold(context, it) }
        TokenStore.setUserId(context, null)
        TokenStore.setToken(context, null)
        WidgetData.clear(context) // don't keep note titles on the home screen after signing out
        ErrandWorker.cancelAll(context)
        ChangesWorker.cancel(context)
        ErrandSync.clear(context)
        WearBridge.clearToken(context) // signed out → the watch can't upload either
        call.resolve()
    }

    @PluginMethod
    fun getLaunchRoute(call: PluginCall) {
        call.resolve(JSObject().put("route", pendingRoute))
        pendingRoute = null
    }

    // ── Errands: location for arrival reminders ───────────────────────────

    private fun locationJson() = JSObject().apply {
        val fine = getPermissionState("location").toString()
        put("foreground", fine)
        put(
            "background",
            when {
                Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> fine // no separate "all the time" before Android 10
                fine != "granted" -> "prompt"
                else -> getPermissionState("backgroundLocation").toString()
            },
        )
    }

    @PluginMethod
    fun checkLocation(call: PluginCall) = call.resolve(locationJson())

    /** Step 1: "While using the app". */
    @PluginMethod
    fun requestLocation(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) return call.resolve(locationJson())
        requestPermissionForAlias("location", call, "locationResult")
    }

    /** Step 2: "Allow all the time" (Android 11+ shows its settings screen). */
    @PluginMethod
    fun requestBackgroundLocation(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("location") != PermissionState.GRANTED ||
            getPermissionState("backgroundLocation") == PermissionState.GRANTED
        ) return call.resolve(locationJson())
        requestPermissionForAlias("backgroundLocation", call, "locationResult")
    }

    @PermissionCallback
    private fun locationResult(call: PluginCall) {
        ErrandWorker.syncNow(context) // register geofences now that we may
        call.resolve(locationJson())
    }

    /** Settings → Location reminders: permissions, armed geofences, last event, cached reminders */
    @PluginMethod
    fun getLocationStatus(call: PluginCall) {
        val pm = context.getSystemService(android.os.PowerManager::class.java)
        val coarseOnly = androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED &&
            androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED
        val reminders = org.json.JSONArray().apply {
            ErrandStore.errands(context).forEach { e ->
                val last = e.branches.mapNotNull { ErrandStore.lastEventFor(context, it.key) }.maxByOrNull { it.optLong("at") }
                put(JSONObject().put("id", e.id).put("kind", e.kind).put("when", e.whenAt).put("place", e.placeName)
                    .put("fences", e.branches.size).put("radiusM", e.radiusM.toInt()).put("locallyDone", ErrandStore.isLocallyDone(context, e.id))
                    .put("snoozedUntil", ErrandStore.snoozedUntil(context, e.id))
                    .put("inside", e.branches.firstOrNull()?.let { ErrandStore.inside(context, it.key) } ?: JSONObject.NULL)
                    .put("lastEvent", last ?: JSONObject.NULL))
            }
        }
        val o = JSONObject()
            .put("location", locationJson())
            .put("precise", !coarseOnly)
            .put("notifications", if (Build.VERSION.SDK_INT < 33) "granted" else getPermissionState("notifications").toString())
            .put("batteryUnrestricted", pm?.isIgnoringBatteryOptimizations(context.packageName) == true)
            .put("locationOn", runCatching { context.getSystemService(android.location.LocationManager::class.java)?.isLocationEnabled == true }.getOrDefault(true))
            // Google Location Accuracy off ⇒ no network (Wi-Fi / cell) location ⇒ slow, unreliable geofences
            .put("googleAccuracy", runCatching { context.getSystemService(android.location.LocationManager::class.java)?.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER) == true }.getOrDefault(true))
            .put("fallback", LocationCheck.isRunning(context))
            .put("notificationsEnabled", Notifications.canPost(context))
            .put("arrivalChannelBlocked", runCatching {
                Notifications.ensureChannels(context)
                context.getSystemService(android.app.NotificationManager::class.java)?.getNotificationChannel(Notifications.CH_ARRIVAL)?.importance == android.app.NotificationManager.IMPORTANCE_NONE
            }.getOrDefault(false))
            .put("armed", ErrandStore.armedInfo(context))
            .put("lastEvent", ErrandStore.lastEvent(context) ?: JSONObject.NULL)
            .put("reminders", reminders)
        call.resolve(JSObject.fromJSONObject(o))
    }

    /** "Test this reminder": show its notification now, as if you had arrived / left */
    @PluginMethod
    fun testLocationReminder(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id is required")
        Thread {
            ErrandSync.syncBlocking(context) // latest list first
            val e = ErrandStore.errand(context, id)
            if (e == null) call.reject("This reminder isn't armed on the phone yet (check the place and permissions)")
            else {
                ErrandStore.recordEvent(context, "test", e.branches.firstOrNull()?.key ?: "", "app", e.whenAt)
                ErrandWorker.uploadEvents(context)
                ArrivalNotifier.show(context, e, e.placeName)
                call.resolve(JSObject().put("shown", true))
            }
        }.start()
    }

    /** Distance from you now to each reminder's place. Computed on the phone; the location isn't sent anywhere. */
    @PluginMethod
    fun getReminderDistances(call: PluginCall) {
        Thread {
            val loc = LocationCheck.currentLocation(context, fresh = true) ?: LocationCheck.currentLocation(context, fresh = false)
            if (loc == null) call.resolve(JSObject().put("available", false))
            else {
                // A fresh location is also a fallback check
                LocationCheck.check(context, loc, "app")
                call.resolve(JSObject().put("available", true).put("accuracyM", loc.accuracy.toInt())
                    .put("ageSec", ((System.currentTimeMillis() - loc.time) / 1000).toInt())
                    .put("reminders", LocationCheck.distances(context, loc)))
            }
        }.start()
    }

    /** Android's built-in Geocoder (fallback when OpenStreetMap finds nothing): { query, nearLat?, nearLng? } */
    @PluginMethod
    fun geocode(call: PluginCall) {
        val query = call.getString("query")?.trim().orEmpty()
        if (query.isEmpty()) return call.reject("query is required")
        val lat = call.getDouble("nearLat")
        val lng = call.getDouble("nearLng")
        Thread {
            val results = DeviceGeocoder.search(context, query, if (lat != null && lng != null) lat to lng else null)
            call.resolve(JSObject().put("available", DeviceGeocoder.available()).put("results", com.getcapacitor.JSArray(results.toString())))
        }.start()
    }

    /** Coordinates → nearest address with Android's Geocoder: { lat, lng } */
    @PluginMethod
    fun reverseGeocode(call: PluginCall) {
        val lat = call.getDouble("lat") ?: return call.reject("lat is required")
        val lng = call.getDouble("lng") ?: return call.reject("lng is required")
        Thread {
            call.resolve(JSObject().put("available", DeviceGeocoder.available()).put("address", DeviceGeocoder.reverse(context, lat, lng)))
        }.start()
    }

    /** Settings → App icon: { tile: dark | light | amoled } */
    @PluginMethod
    fun getAppIcon(call: PluginCall) = call.resolve(JSObject().put("tile", AppIcon.current(context)).put("tiles", com.getcapacitor.JSArray(AppIcon.TILES)))

    @PluginMethod
    fun setAppIcon(call: PluginCall) {
        val tile = call.getString("tile") ?: return call.reject("tile is required")
        if (!AppIcon.set(context, tile)) return call.reject("Unknown icon: $tile")
        call.resolve(JSObject().put("tile", AppIcon.current(context)))
    }

    /** Settings → Notifications */
    @PluginMethod
    fun getNotificationStatus(call: PluginCall) = call.resolve(JSObject.fromJSONObject(Notifications.status(context)))

    @PluginMethod
    fun sendTestNotification(call: PluginCall) {
        val target = call.getString("target") ?: "phone"
        val ok = Notifications.sendTest(context, target)
        ErrandStore.recordEvent(context, "test", "", "notification", target)
        call.resolve(JSObject().put("sent", ok).put("watchApp", WearBridge.watchAppKnown(context)))
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        runCatching { context.startActivity(Notifications.settingsIntent(context, call.getString("channel"))) }
            .onFailure { return call.reject("Couldn't open notification settings") }
        call.resolve()
    }

    /** Google Location Accuracy (Wi-Fi/cell positioning) — falls back to the Location settings screen. */
    @PluginMethod
    fun openLocationAccuracy(call: PluginCall) {
        val intents = listOf(
            Intent("com.google.android.gms.location.settings.GOOGLE_LOCATION_ACCURACY"),
            Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS),
        )
        for (i in intents) {
            if (runCatching { context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) return call.resolve()
        }
        call.reject("Couldn't open location settings")
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) return call.resolve(permissionsJson())
        requestPermissionForAlias("notifications", call, "permissionsResult")
    }

    /** Errand list changed in the app (checked items, done, new errand): refresh geofences. */
    @PluginMethod
    fun syncErrands(call: PluginCall) {
        ErrandWorker.syncNow(context)
        call.resolve()
    }

    // ── Permissions ────────────────────────────────────────────────────────

    private fun permissionsJson() = JSObject().apply {
        put("microphone", getPermissionState("microphone").toString())
        // Before Android 13 notifications need no runtime permission
        put("notifications", if (Build.VERSION.SDK_INT < 33) "granted" else getPermissionState("notifications").toString())
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) = call.resolve(permissionsJson())

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val aliases = if (Build.VERSION.SDK_INT >= 33) arrayOf("microphone", "notifications") else arrayOf("microphone")
        requestPermissionForAliases(aliases, call, "permissionsResult")
    }

    @PermissionCallback
    private fun permissionsResult(call: PluginCall) = call.resolve(permissionsJson())

    // ── Settings → Recording & shortcuts (this phone only) ─────────────────

    private fun recorderJson() = JSObject.fromJSONObject(JSONObject()
        .put("settings", RecorderPrefs.get(context).toJson())
        .put("watch", WatchRecSync.get(context))
        .put("status", ShortcutSetup.status(context)))

    /** Settings → Accidental recordings: the last 20 recording starts (phone + watch), newest first */
    @PluginMethod
    fun getRecordingLog(call: PluginCall) {
        val out = JSObject()
        out.put("entries", RecordingLog.recent(context, call.getInt("limit") ?: 20))
        call.resolve(out)
    }

    @PluginMethod
    fun clearRecordingLog(call: PluginCall) {
        RecordingLog.clear(context)
        call.resolve()
    }

    @PluginMethod
    fun getRecorderSettings(call: PluginCall) = call.resolve(recorderJson())

    @PluginMethod
    fun setRecorderSettings(call: PluginCall) {
        val patch = call.getObject("settings")
        if (patch != null) {
            val s = RecorderPrefs.update(context, patch)
            // Turning a double-press shortcut off while nothing else uses it: stop the service too
            if (!s.doublePressUpStart && !s.doublePressDownStop) VolumeShortcutService.instance?.turnOff()
        }
        call.getObject("watch")?.let { WatchRecSync.update(context, it) }
        call.resolve(recorderJson())
    }

    @PluginMethod
    fun setKeyTest(call: PluginCall) {
        keyTestActive = call.getBoolean("enabled", false) == true
        call.resolve()
    }

    @PluginMethod
    fun openShortcutSetup(call: PluginCall) {
        val target = call.getString("target") ?: return call.reject("target is required")
        call.resolve(JSObject().put("opened", ShortcutSetup.open(context, target)))
    }

    @PluginMethod
    fun addShortcut(call: PluginCall) {
        val kind = call.getString("kind")
        when (kind) {
            "widget" -> call.resolve(JSObject().put("requested", ShortcutSetup.pinWidget(context)))
            "quickRecord" -> call.resolve(JSObject().put("requested", ShortcutSetup.pinQuickRecord(context)))
            "tile" -> ShortcutSetup.addTile(context) { call.resolve(JSObject().put("result", it)) }
            else -> call.reject("Unknown shortcut")
        }
    }

    /** "Turn off" the double-press shortcuts: the service disables itself (Android 7+) */
    @PluginMethod
    fun turnOffVolumeShortcuts(call: PluginCall) {
        RecorderPrefs.update(context, JSONObject().put("doublePressUpStart", false).put("doublePressDownStop", false))
        val svc = VolumeShortcutService.instance
        if (svc != null) svc.turnOff() else if (VolumeShortcutService.isEnabled(context)) ShortcutSetup.open(context, "accessibility")
        call.resolve(recorderJson())
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
