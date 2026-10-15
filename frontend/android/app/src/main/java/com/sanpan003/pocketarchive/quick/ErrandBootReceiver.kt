package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Geofences don't survive a reboot or an app update: register them again. */
class ErrandBootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (TokenStore.token(ctx) == null) return
        ErrandWorker.syncNow(ctx)
        ErrandWorker.schedulePeriodic(ctx)
    }
}
