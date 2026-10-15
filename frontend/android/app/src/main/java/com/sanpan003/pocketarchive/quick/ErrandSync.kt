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

    @SuppressLint("MissingPermission") // checked in hasForegroundLocation()
    fun registerGeofences(ctx: Context) {
        val geofencing = LocationServices.getGeofencingClient(ctx)
        val pending = geofenceIntent(ctx)
        try {
            Tasks.await(geofencing.removeGeofences(pending), 10, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.w(TAG, "Could not remove old geofences: ${e.message}")
        }
        if (!hasForegroundLocation(ctx)) return

        // One geofence per store (shared by errands at the same store), closest to home first
        val branches = ErrandStore.armed(ctx)
            .flatMap { it.branches }
            .distinctBy { it.key }
            .sortedBy { it.distanceM ?: Int.MAX_VALUE }
            .take(MAX_GEOFENCES)
        if (branches.isEmpty()) return

        val fences = branches.map { b ->
            Geofence.Builder()
                .setRequestId(b.key)
                .setCircularRegion(b.lat, b.lng, RADIUS_M)
                .setExpirationDuration(Geofence.NEVER_EXPIRE) // re-synced every 30 min
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                .setLoiteringDelay(DWELL_MS)
                .build()
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofences(fences)
            .build()
        try {
            Tasks.await(geofencing.addGeofences(request, pending), 20, TimeUnit.SECONDS)
            Log.i(TAG, "Armed ${fences.size} store geofence(s)")
        } catch (e: Exception) {
            // e.g. location turned off (GEOFENCE_NOT_AVAILABLE); the next sync tries again
            Log.w(TAG, "Could not add geofences: ${e.message}")
        }
    }

    /** Signed out: forget errands and remove geofences. */
    fun clear(ctx: Context) {
        ErrandStore.clear(ctx)
        runCatching { LocationServices.getGeofencingClient(ctx).removeGeofences(geofenceIntent(ctx)) }
    }

    // ── Calls back to the server (from workers) ────────────────────────────

    /** POST and report: true = done (or will never work), false = retry later. */
    fun post(ctx: Context, path: String, body: JSONObject = JSONObject()): Boolean {
        val apiBase = TokenStore.apiBase(ctx) ?: return true
        val token = TokenStore.token(ctx) ?: return true
        val request = Request.Builder()
            .url("$apiBase$path")
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            client.newCall(request).execute().use { r -> r.isSuccessful || r.code in 400..499 }
        } catch (e: IOException) {
            false
        }
    }
}
