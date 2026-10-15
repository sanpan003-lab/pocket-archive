package com.sanpan003.pocketarchive.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/** "Done" on the watch's arrival notification → the phone marks the errand done. */
class ArrivalActionReceiver : BroadcastReceiver() {
    companion object {
        const val EXTRA_ID = "errandId"
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        NotificationManagerCompat.from(ctx).cancel(3000 + (id.hashCode() and 0xFFFF))
        PhoneLink.putDone(ctx, id)
        Haptics.success(ctx)
    }
}
