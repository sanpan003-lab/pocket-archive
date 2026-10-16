package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * What a volume key does while recording (Settings → Recording & shortcuts):
 * up = stop / ignore, down = stop / discard / ignore, long-press down = discard.
 *
 * Fed by the recorder's media session (screen off / other apps) and by the
 * activity (app on screen). With "long-press discards" on, a short press acts
 * after LONG_WAIT_MS so a hold can still turn into a discard; a hold is ≥ 2
 * further events for the same key within that window (key repeat), so a quick
 * double tap is still a normal press.
 */
object RecorderKeys {
    enum class Key { UP, DOWN }

    private const val LONG_WAIT_MS = 800L
    private val main = Handler(Looper.getMainLooper())
    private var pending: Runnable? = null
    private var pendingKey: Key? = null
    private var extraEvents = 0

    /** Returns true when the key was used (don't change the volume). */
    fun onKey(ctx: Context, key: Key): Boolean {
        if (!RecorderState.recording) return false
        val s = RecorderPrefs.get(ctx)
        if (!s.capturesKeys) return false

        // A held key keeps sending events: count them toward a long press
        if (pendingKey == key) {
            extraEvents++
            if (key == Key.DOWN && extraEvents >= 2) {
                cancelPending()
                act(ctx, RecorderPrefs.DISCARD, "Long-press volume down")
            }
            return true
        }

        when (key) {
            Key.UP -> act(ctx, s.volumeUp, "Volume up")
            Key.DOWN -> if (s.longPressDownDiscard) {
                pendingKey = key
                extraEvents = 0
                val r = Runnable { pendingKey = null; pending = null; act(ctx, s.volumeDown, "Volume down") }
                pending = r
                main.postDelayed(r, LONG_WAIT_MS)
            } else {
                act(ctx, s.volumeDown, "Volume down")
            }
        }
        return true
    }

    private fun cancelPending() {
        pending?.let { main.removeCallbacks(it) }
        pending = null
        pendingKey = null
        extraEvents = 0
    }

    /** Recording ended some other way: forget a half-finished press */
    fun reset() = cancelPending()

    private fun act(ctx: Context, action: String, label: String) {
        when (action) {
            RecorderPrefs.IGNORE -> RecorderGuard.note("$label ignored (setting)")
            else -> {
                if (!RecorderGuard.canStopByKey()) return
                RecorderGuard.note("$label → ${if (action == RecorderPrefs.DISCARD) "discard" else "stop & save"} at ${SystemClock.elapsedRealtime()}")
                if (action == RecorderPrefs.DISCARD) QuickActions.discard(ctx) else QuickActions.stop(ctx)
            }
        }
    }
}
