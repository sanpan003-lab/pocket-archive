package com.sanpan003.pocketarchive.quick

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.sanpan003.pocketarchive.MainActivity

/**
 * Invisible, instant activity used by the widget and Quick Settings tile.
 * Android only lets a microphone foreground service start while the app is in
 * the foreground; this activity provides that moment (also over the lock
 * screen) and closes itself without showing the app.
 */
class RecordTrampolineActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setShowWhenLocked(true)

        // "Stop Recording" launcher entry (Samsung side key / Routines): stop if recording, else nothing
        if (intent?.component?.className?.contains(".StopRecordLauncher") == true) {
            QuickActions.stop(this)
            finish()
            return
        }

        val ready = when (intent?.action) {
            QuickActions.ACTION_START_RECORDING -> QuickActions.start(this, "shortcut")
            else -> QuickActions.toggle(this, "widget/tile")
        }
        if (!ready) {
            // Needs mic permission or sign-in: open the app where that's handled
            startActivity(
                Intent(this, MainActivity::class.java)
                    .setAction(QuickActions.ACTION_OPEN_ROUTE)
                    .putExtra(QuickActions.EXTRA_ROUTE, "/quick")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        // Stay "foreground" for a moment while the service promotes itself
        Handler(Looper.getMainLooper()).postDelayed({ finish() }, 300)
    }
}
