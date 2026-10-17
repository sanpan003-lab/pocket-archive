package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * Play services geofence transitions.
 * - ENTER: you're inside. Arrival fires right away for places ≥ 250 m (airports, campuses, malls);
 *   smaller places wait for DWELL (a short moment inside) so driving past doesn't count.
 * - DWELL: arrival for small places.
 * - EXIT: "when I leave".
 * Every event also updates the inside/outside state the fallback location check uses.
 */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            val code = GeofenceStatusCodes.getStatusCodeString(event.errorCode)
            Log.w("Errands", "Geofence error: $code")
            ErrandStore.recordEvent(ctx, "error", "", "geofence", code)
            // Geofences are dropped when location is switched off; re-arm on the next sync
            if (event.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                ErrandSync.forceRearm(ctx)
                ErrandWorker.syncNow(ctx)
            }
            return
        }
        val transition = event.geofenceTransition
        val armed = ErrandStore.armed(ctx)
        event.triggeringGeofences?.forEach { fence ->
            val key = fence.requestId
            val errands = armed.filter { e -> e.branches.any { it.key == key } }
            val radius = errands.maxOfOrNull { if (it.isReminder) it.radiusM else 150f } ?: 150f
            when (transition) {
                Geofence.GEOFENCE_TRANSITION_ENTER -> {
                    ErrandStore.setInside(ctx, key, true)
                    ErrandStore.recordEvent(ctx, "enter", key, "geofence")
                    Log.i("Errands", "Geofence enter: $key (${radius.toInt()} m)")
                    if (radius >= LocationCheck.SMALL_RADIUS_M) ArrivalNotifier.onArrive(ctx, key, leaving = false, source = "enter")
                }
                Geofence.GEOFENCE_TRANSITION_DWELL -> {
                    ErrandStore.setInside(ctx, key, true)
                    ErrandStore.recordEvent(ctx, "dwell", key, "geofence")
                    Log.i("Errands", "Geofence dwell: $key")
                    ArrivalNotifier.onArrive(ctx, key, leaving = false, source = "dwell")
                }
                Geofence.GEOFENCE_TRANSITION_EXIT -> {
                    ErrandStore.setInside(ctx, key, false)
                    ErrandStore.recordEvent(ctx, "exit", key, "geofence")
                    Log.i("Errands", "Geofence leave: $key")
                    ArrivalNotifier.onArrive(ctx, key, leaving = true, source = "exit")
                }
            }
        }
        ErrandWorker.uploadEvents(ctx)
    }
}
