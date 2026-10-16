package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.os.SystemClock
import android.util.Log

/**
 * Double-action guards. One volume-up press can reach both the app (media
 * session → stop) and a Samsung routine (→ opens Quick Record → start):
 * - a start request within guardSec after a stop is the same press → ignored
 * - stop keys within 1.5 s after a start are the press that started it → ignored
 */
object RecorderGuard {
    private const val TAG = "RecorderGuard"
    const val STOP_KEY_GRACE_MS = 1_500L

    @Volatile var lastStartAt = 0L
        private set
    @Volatile var lastStopAt = 0L
        private set
    /** What the last guard decided (shown by Settings → Test) */
    @Volatile var lastDecision: String = ""
        private set

    fun started() { lastStartAt = SystemClock.elapsedRealtime() }
    fun stopped() { lastStopAt = SystemClock.elapsedRealtime() }

    /** May a start request (launcher, routine, tile, widget, shortcut) start a recording now? */
    fun canStart(ctx: Context, source: String): Boolean {
        val since = SystemClock.elapsedRealtime() - lastStopAt
        val window = RecorderPrefs.get(ctx).guardSec * 1000L
        if (lastStopAt > 0 && since < window) {
            note("Ignored start from $source ${since} ms after a stop (same press)")
            return false
        }
        return true
    }

    /** May a volume key stop the recording now? */
    fun canStopByKey(): Boolean {
        val since = SystemClock.elapsedRealtime() - lastStartAt
        if (since < STOP_KEY_GRACE_MS) {
            note("Ignored a stop key ${since} ms after the start (the press that started it)")
            return false
        }
        return true
    }

    /** A Quick Record launch right after an app-captured stop belongs to that press */
    fun isEchoOfStop(ctx: Context): Boolean {
        val since = SystemClock.elapsedRealtime() - lastStopAt
        return lastStopAt > 0 && since < RecorderPrefs.get(ctx).guardSec * 1000L
    }

    fun note(text: String) {
        lastDecision = text
        Log.i(TAG, text)
    }
}
