package com.sanpan003.pocketarchive.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** "Done" and "Snooze 1 hr" on an arrival notification (also from a paired watch). */
class ErrandActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_DONE = "com.sanpan003.pocketarchive.errand.DONE"
        const val ACTION_SNOOZE = "com.sanpan003.pocketarchive.errand.SNOOZE"
        const val EXTRA_ID = "errandId"
        const val EXTRA_PLACE = "place"
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        ArrivalNotifier.cancel(ctx, id)
        when (intent.action) {
            ACTION_DONE -> {
                // Stop reminding right away; the server is told when there's a connection
                ErrandStore.markLocallyDone(ctx, id)
                ErrandWorker.markDone(ctx, id)
                ErrandWorker.syncNow(ctx)
            }
            ACTION_SNOOZE -> {
                ErrandStore.snooze(ctx, id, System.currentTimeMillis() + ArrivalNotifier.SNOOZE_MS)
                ErrandWorker.snooze(ctx, id, intent.getStringExtra(EXTRA_PLACE), ArrivalNotifier.SNOOZE_MS)
            }
        }
    }
}
