package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager

/**
 * Geofences don't survive a reboot, an app update or location being switched off:
 * register them again (and restart the fallback location check).
 */
class ErrandBootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val action = intent.action
        if (action !in ACTIONS) return
        if (TokenStore.token(ctx) == null) return
        if (action == LocationManager.PROVIDERS_CHANGED_ACTION || action == LocationManager.MODE_CHANGED_ACTION) {
            val on = runCatching { ctx.getSystemService(LocationManager::class.java)?.isLocationEnabled == true }.getOrDefault(false)
            val prefs = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE)
            val was = prefs.getBoolean("locOn", true)
            prefs.edit().putBoolean("locOn", on).apply()
            if (!on || was) return // only "turned back on" needs a re-arm
        }
        ErrandSync.forceRearm(ctx)
        ErrandWorker.syncNow(ctx)
        ErrandWorker.schedulePeriodic(ctx)
    }

    companion object {
        private val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            LocationManager.PROVIDERS_CHANGED_ACTION, LocationManager.MODE_CHANGED_ACTION,
        )
    }
}
