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
import org.json.JSONObject

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

    override fun load() {
        instance = this
        Notifications.ensureChannels(context)
        PendingStore.recoverOrphans(context)
        RecorderState.addStateListener(stateListener)
        RecorderState.addLevelListener(levelListener)
        if (TokenStore.token(context) != null) {
            ErrandWorker.schedulePeriodic(context)
            ErrandWorker.syncNow(context)
            ChangesWorker.schedule(context)
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
        WidgetData.refreshAsync(context)
        ErrandWorker.schedulePeriodic(context)
        ErrandWorker.syncNow(context)
        ChangesWorker.schedule(context)
        WearBridge.async { WearBridge.sendToken(context) } // the watch's direct-upload fallback
        call.resolve()
    }

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
        call.resolve(JSObject().put("token", TokenStore.token(context)))
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
