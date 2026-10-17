package com.sanpan003.pocketarchive.quick

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Arrival reminders: fetch active errands and register geofences around their
 * stores. Android allows 100 geofences per app, so the stores closest to home
 * win. The phone never sends its location — only store coordinates come down.
 */
object ErrandSync {
    private const val TAG = "Errands"
    private const val MAX_GEOFENCES = 100
    private const val RADIUS_M = 150f
    private const val DWELL_MS = 60_000      // ~1 minute in the store, so driving past doesn't count
    private const val PERSONAL_DWELL_MS = 30_000 // small personal places (home): a short moment inside
    private const val FENCE_VERSION = 2      // bump when the transition rules change → re-arm after an update

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    fun hasForegroundLocation(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** "Allow all the time" (before Android 10 there is no separate background permission). */
    fun hasBackgroundLocation(ctx: Context) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Permission state that affects geofences; a change re-arms them. */
    fun permissionSignature(ctx: Context) =
        "fg=${hasForegroundLocation(ctx)},bg=${hasBackgroundLocation(ctx)},v=$FENCE_VERSION"

    /** Next registerGeofences() re-adds everything (location came back on, permissions changed…). */
    fun forceRearm(ctx: Context) = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE).edit().remove("sig").apply()

    /** App opened: if a location permission changed since the fences were added, sync now. */
    fun onAppResumed(ctx: Context) {
        val prefs = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE)
        if (TokenStore.token(ctx) == null) return
        if (prefs.getString("perms", null) != permissionSignature(ctx)) {
            forceRearm(ctx)
            ErrandWorker.syncNow(ctx)
        }
    }

    private fun geofenceIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 0, Intent(ctx, GeofenceReceiver::class.java),
        // Play services adds the event extras → must be mutable
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
    )

    /** Fetch (if possible) and re-register geofences. Runs network + Play services calls: background thread only. */
    fun syncBlocking(ctx: Context) {
        val apiBase = TokenStore.apiBase(ctx)
        val token = TokenStore.token(ctx)
        if (apiBase == null || token == null) {
            clear(ctx)
            return
        }
        try {
            val request = Request.Builder()
                .url("$apiBase/api/errands/active")
                .header("Authorization", "Bearer $token")
                .build()
            client.newCall(request).execute().use { response ->
                when {
                    response.isSuccessful -> ErrandStore.save(ctx, JSONObject(response.body.string()).getJSONArray("errands"))
                    response.code == 401 -> { clear(ctx); return }
                    else -> Log.w(TAG, "Errand sync HTTP ${response.code}; keeping cached list")
                }
            }
        } catch (e: IOException) {
            Log.i(TAG, "Offline; re-arming cached errands")
        } catch (e: JSONException) {
            Log.w(TAG, "Unexpected errand list", e)
        }
        registerGeofences(ctx)
    }

    /**
     * Re-registering geofences resets their state (a DWELL in progress is lost), so the
     * same set isn't re-added on every sync — only when it changed, after a reboot,
     * or when forced (location came back on).
     */
    @SuppressLint("MissingPermission") // checked in hasForegroundLocation()
    fun registerGeofences(ctx: Context, force: Boolean = false) {
        val geofencing = LocationServices.getGeofencingClient(ctx)
        val pending = geofenceIntent(ctx)
        val signature = ErrandStore.armed(ctx).flatMap { e -> e.branches.map { "${it.key}/${e.radiusM}/${e.whenAt}" } }.sorted().joinToString(",") +
            "|" + permissionSignature(ctx)
        val prefs = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE)
        val now = android.os.SystemClock.elapsedRealtime()
        val armedAt = prefs.getLong("elapsed", -1L)
        if (!force && signature == prefs.getString("sig", null) && armedAt in 0..now) {
            Log.i(TAG, "Geofences unchanged; keeping them armed")
            LocationCheck.update(ctx, ErrandStore.armed(ctx).isNotEmpty())
            return
        }
        prefs.edit().putString("perms", permissionSignature(ctx)).apply()
        try {
            Tasks.await(geofencing.removeGeofences(pending), 10, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.w(TAG, "Could not remove old geofences: ${e.message}")
        }
        prefs.edit().remove("sig").apply()
        if (!hasForegroundLocation(ctx)) {
            ErrandStore.setArmedCount(ctx, 0, "Location permission is off")
            LocationCheck.update(ctx, false)
            return
        }

        // One geofence per place (shared by errands at the same store). Personal places
        // (location reminders) first, then stores closest to home. Radius comes from the server
        // (Auto = the OpenStreetMap area of the place, 100 m – 2 km).
        // Arrive: ENTER (places ≥ 250 m fire on entering) + DWELL for small places (30 s personal, 1 min stores).
        // Leave: EXIT (+ ENTER, so the inside/outside state is known).
        data class Fence(val key: String, val lat: Double, val lng: Double, val radius: Float, val leave: Boolean, val personal: Boolean, val order: Int)
        val chosen = ErrandStore.armed(ctx)
            .flatMap { e -> e.branches.map { b -> Fence(b.key, b.lat, b.lng, if (e.isReminder) e.radiusM else RADIUS_M, e.leaving, e.isReminder, if (e.isReminder) -1 else (b.distanceM ?: Int.MAX_VALUE)) } }
            .distinctBy { it.key }
            .sortedBy { it.order }
            .take(MAX_GEOFENCES)
        fun build(f: Fence) = Geofence.Builder()
            .setRequestId(f.key)
            .setCircularRegion(f.lat, f.lng, f.radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .apply {
                when {
                    f.leave -> setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                    f.radius >= LocationCheck.SMALL_RADIUS_M -> setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                    else -> setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_DWELL or Geofence.GEOFENCE_TRANSITION_EXIT)
                        .setLoiteringDelay(if (f.personal) PERSONAL_DWELL_MS else DWELL_MS)
                }
            }
            .build()
        if (chosen.isEmpty()) {
            ErrandStore.setArmedCount(ctx, 0, null)
            prefs.edit().putString("sig", signature).putLong("elapsed", now).apply()
            LocationCheck.update(ctx, false)
            return
        }

        // Stores: being in the store already counts (initial DWELL). Personal places: only a real
        // arrival / departure — "when I get home" said at home shouldn't fire a minute later.
        val requests = listOf(
            chosen.filter { !it.personal } to GeofencingRequest.INITIAL_TRIGGER_DWELL,
            chosen.filter { it.personal } to 0,
        ).filter { it.first.isNotEmpty() }.map { (list, initial) ->
            GeofencingRequest.Builder().setInitialTrigger(initial).addGeofences(list.map(::build)).build()
        }
        try {
            for (r in requests) Tasks.await(geofencing.addGeofences(r, pending), 20, TimeUnit.SECONDS)
            Log.i(TAG, "Armed ${chosen.size} geofence(s) (${chosen.count { it.personal }} personal)")
            ErrandStore.setArmedCount(ctx, chosen.size, null)
            ErrandStore.recordEvent(ctx, "registered", "", "sync", "${chosen.size} places (${chosen.count { it.personal }} reminders)")
            prefs.edit().putString("sig", signature).putLong("elapsed", now).apply()
        } catch (e: Exception) {
            // e.g. location turned off (GEOFENCE_NOT_AVAILABLE); the next sync tries again
            Log.w(TAG, "Could not add geofences: ${e.message}")
            ErrandStore.setArmedCount(ctx, 0, e.message ?: "Could not add geofences")
            ErrandStore.recordEvent(ctx, "error", "", "sync", (e.message ?: "Could not add geofences").take(80))
        }
        // Fallback for missed events (low-power location every ~15 min while something is armed)
        LocationCheck.update(ctx, true)
    }

    /** Signed out: forget errands and remove geofences. */
    fun clear(ctx: Context) {
        ErrandStore.clear(ctx)
        ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE).edit().clear().apply()
        runCatching { LocationServices.getGeofencingClient(ctx).removeGeofences(geofenceIntent(ctx)) }
        runCatching { LocationCheck.update(ctx, false) }
    }

    // ── Calls back to the server (from workers) ────────────────────────────

    /** POST and report: true = done (or will never work), false = retry later. */
    fun post(ctx: Context, path: String, body: JSONObject = JSONObject()) = request(ctx, "POST", path, body)

    fun request(ctx: Context, method: String, path: String, body: JSONObject = JSONObject()): Boolean =
        requestJson(ctx, method, path, body).first

    /** (done-or-permanent-failure, response JSON if successful). false = retry later. */
    fun requestJson(ctx: Context, method: String, path: String, body: JSONObject = JSONObject()): Pair<Boolean, JSONObject?> {
        val apiBase = TokenStore.apiBase(ctx) ?: return true to null
        val token = TokenStore.token(ctx) ?: return true to null
        val request = Request.Builder()
            .url("$apiBase$path")
            .header("Authorization", "Bearer $token")
            .method(method, body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newCall(request).execute().use { r ->
                val json = if (r.isSuccessful) runCatching { JSONObject(r.body.string()) }.getOrNull() else null
                (r.isSuccessful || r.code in 400..499) to json
            }
        } catch (e: IOException) {
            false to null
        }
    }
}
