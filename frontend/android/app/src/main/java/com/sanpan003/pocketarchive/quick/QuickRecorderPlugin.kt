package com.sanpan003.pocketarchive.quick

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

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
    ],
)
class QuickRecorderPlugin : Plugin() {

    companion object {
        @Volatile private var instance: QuickRecorderPlugin? = null
        @Volatile private var appVisible = false
        @Volatile private var pendingRoute: String? = null
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

        fun notifyPending(ctx: Context) {
            instance?.deliver("pending", JSObject().put("count", PendingStore.count(ctx)))
        }
    }

    private val stateListener: (Boolean) -> Unit = { recording ->
        deliver("state", stateJson().put("recording", recording))
    }
    private var lastLevelAt = 0L
    private val levelListener: (Double) -> Unit = { level ->
        val now = System.currentTimeMillis()
        if (appVisible && now - lastLevelAt > 150) {
            lastLevelAt = now
            deliver("level", JSObject().put("level", level))
        }
    }

    override fun load() {
        instance = this
        Notifications.ensureChannels(context)
        PendingStore.recoverOrphans(context)
        RecorderState.addStateListener(stateListener)
        RecorderState.addLevelListener(levelListener)
        if (TokenStore.token(context) != null) {
            ErrandWorker.schedulePeriodic(context)
            ErrandWorker.syncNow(context)
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

    override fun handleOnPause() { appVisible = false }

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
        QuickActions.start(context)
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
        TokenStore.setToken(context, call.getString("token"))
        UploadWorker.retryAllNow(context) // anything waiting on sign-in goes now
        WidgetData.refreshAsync(context)
        ErrandWorker.schedulePeriodic(context)
        ErrandWorker.syncNow(context)
        WearBridge.async { WearBridge.sendToken(context) } // the watch's direct-upload fallback
        call.resolve()
    }

    @PluginMethod
    fun getToken(call: PluginCall) {
        call.resolve(JSObject().put("token", TokenStore.token(context)))
    }

    @PluginMethod
    fun clearToken(call: PluginCall) {
        TokenStore.setToken(context, null)
        WidgetData.clear(context) // don't keep note titles on the home screen after signing out
        ErrandWorker.cancelAll(context)
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

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
