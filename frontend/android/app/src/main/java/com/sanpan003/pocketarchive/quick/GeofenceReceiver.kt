package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/** Play services → "you've been at this store for a minute". */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.w("Errands", "Geofence error: ${GeofenceStatusCodes.getStatusCodeString(event.errorCode)}")
            // Geofences are dropped when location is switched off; re-arm on the next sync
            if (event.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) ErrandWorker.syncNow(ctx)
            return
        }
        val transition = event.geofenceTransition
        if (transition != Geofence.GEOFENCE_TRANSITION_DWELL && transition != Geofence.GEOFENCE_TRANSITION_ENTER) return
        event.triggeringGeofences?.forEach { ArrivalNotifier.onArrive(ctx, it.requestId) }
    }
}
