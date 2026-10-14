package com.sanpan003.pocketarchive.quick

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/** Start/stop recording from any entry point (app, widget, tile, shortcut). */
object QuickActions {
    const val ACTION_START_RECORDING = "com.sanpan003.pocketarchive.START_RECORDING"
    const val ACTION_TOGGLE_RECORDING = "com.sanpan003.pocketarchive.TOGGLE_RECORDING"
    const val ACTION_OPEN_INBOX = "com.sanpan003.pocketarchive.OPEN_INBOX"
    const val ACTION_OPEN_ROUTE = "com.sanpan003.pocketarchive.OPEN_ROUTE"
    const val EXTRA_ROUTE = "route"

    fun hasMicPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** Why recording can't start from outside the app (null = ready). */
    fun blocker(ctx: Context): String? = when {
        !hasMicPermission(ctx) -> "mic"
        TokenStore.token(ctx) == null || TokenStore.apiBase(ctx) == null -> "signin"
        else -> null
    }

    /**
     * Start recording. Must be called while the app is in the foreground
     * (an activity — including the invisible widget/tile trampoline) because
     * Android only lets microphone services start from the foreground.
     * Returns false when the app has to be opened first (permission / sign-in).
     */
    fun start(ctx: Context): Boolean {
        if (blocker(ctx) != null) return false
        if (!RecorderState.recording) {
            ContextCompat.startForegroundService(ctx, QuickRecorderService.intent(ctx, QuickRecorderService.ACTION_START))
        }
        return true
    }

    fun stop(ctx: Context) {
        if (RecorderState.recording) {
            ctx.startService(QuickRecorderService.intent(ctx, QuickRecorderService.ACTION_STOP))
        }
    }

    fun toggle(ctx: Context): Boolean =
        if (RecorderState.recording) { stop(ctx); true } else start(ctx)
}
