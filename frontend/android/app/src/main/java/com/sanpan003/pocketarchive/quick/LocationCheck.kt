package com.sanpan003.pocketarchive.quick

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.util.Log
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Fallback for missed geofence events: while a location reminder or store errand is active,
 * the phone asks for a low-power location about every 15 minutes (and uses any location the
 * 30-minute sync can get). Each one is compared with the armed places on the phone:
 * outside → inside fires an arrival, inside → outside fires a "when I leave".
 * The phone's location never leaves the phone.
 */
object LocationCheck {
    private const val TAG = "Errands"
    /** Places smaller than this wait a short moment inside (DWELL) so driving past doesn't count. */
    const val SMALL_RADIUS_M = 250f
    private const val INTERVAL_MS = 15 * 60_000L

    private fun pending(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 1, Intent(ctx, LocationFallbackReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
    )

    fun isRunning(ctx: Context) = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE).getBoolean("fallback", false)

    /** Low-power location updates on/off, following whether anything is armed. */
    @SuppressLint("MissingPermission")
    fun update(ctx: Context, anyArmed: Boolean) {
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        val prefs = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE)
        if (!anyArmed || !ErrandSync.hasForegroundLocation(ctx) || !ErrandSync.hasBackgroundLocation(ctx)) {
            runCatching { client.removeLocationUpdates(pending(ctx)) }
            prefs.edit().putBoolean("fallback", false).apply()
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(5 * 60_000L)
            .build()
        runCatching { Tasks.await(client.requestLocationUpdates(request, pending(ctx)), 10, TimeUnit.SECONDS) }
            .onSuccess { prefs.edit().putBoolean("fallback", true).apply() }
            .onFailure { Log.w(TAG, "Fallback location updates unavailable: ${it.message}"); prefs.edit().putBoolean("fallback", false).apply() }
    }

    /** Last known location, or a fresh low-power one (background thread). */
    @SuppressLint("MissingPermission")
    fun currentLocation(ctx: Context, fresh: Boolean): Location? {
        if (!ErrandSync.hasForegroundLocation(ctx)) return null
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        return runCatching {
            if (fresh) Tasks.await(client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, CancellationTokenSource().token), 20, TimeUnit.SECONDS)
            else Tasks.await(client.lastLocation, 5, TimeUnit.SECONDS)
        }.getOrNull()
    }

    private fun distance(loc: Location, b: ErrandStore.Branch): Float {
        val out = FloatArray(1)
        Location.distanceBetween(loc.latitude, loc.longitude, b.lat, b.lng, out)
        return out[0]
    }

    /** Distance from here to each armed reminder's place (Settings → Location reminders; stays on the phone). */
    fun distances(ctx: Context, loc: Location): JSONObject {
        val o = JSONObject()
        for (e in ErrandStore.errands(ctx)) {
            val d = e.branches.minOfOrNull { distance(loc, it) } ?: continue
            o.put(e.id, JSONObject().put("distanceM", d.toInt()).put("radiusM", e.radiusM.toInt()).put("inside", d <= e.radiusM))
        }
        return o
    }

    /** Compare one location with every armed place and fire what changed. */
    fun check(ctx: Context, loc: Location, source: String) {
        if (System.currentTimeMillis() - loc.time > 30 * 60_000L) return // too old to mean anything
        val margin = minOf(if (loc.hasAccuracy()) loc.accuracy else 50f, 100f)
        val fences = ErrandStore.armed(ctx).flatMap { e -> e.branches.map { b -> Triple(b, e, if (e.isReminder) e.radiusM else 150f) } }
            .distinctBy { it.first.key }
        for ((branch, errand, radius) in fences) {
            val d = distance(loc, branch)
            val inside = d <= radius + margin * 0.5f
            val outside = d > radius + margin
            val before = ErrandStore.inside(ctx, branch.key)
            when {
                inside -> {
                    ErrandStore.setInside(ctx, branch.key, true)
                    // Arrived (outside before). Stores also count when it's the first reading (you're already there);
                    // personal places don't ("when I get home" said at home).
                    if (!errand.leaving && (before == false || (before == null && !errand.isReminder))) {
                        ErrandStore.recordEvent(ctx, "fallback", branch.key, source, "inside")
                        Log.i(TAG, "Fallback arrive: ${branch.key}")
                        ArrivalNotifier.onArrive(ctx, branch.key, leaving = false, source = "fallback")
                    }
                }
                outside -> {
                    ErrandStore.setInside(ctx, branch.key, false)
                    if (errand.leaving && before == true) {
                        ErrandStore.recordEvent(ctx, "fallback", branch.key, source, "left")
                        Log.i(TAG, "Fallback leave: ${branch.key}")
                        ArrivalNotifier.onArrive(ctx, branch.key, leaving = true, source = "fallback")
                    }
                }
                // In between (GPS uncertainty at the edge): keep the last state
            }
        }
        ErrandWorker.uploadEvents(ctx) // fallback events → the server log (no-op when nothing is queued)
    }
}

/** Low-power location updates (fallback for missed geofence events). */
class LocationFallbackReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val loc = LocationResult.extractResult(intent)?.lastLocation ?: return
        val pending = goAsync()
        Thread {
            try { LocationCheck.check(ctx, loc, "updates") } finally { pending.finish() }
        }.start()
    }
}
