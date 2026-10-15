package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.os.Handler
import android.os.Looper

/**
 * What the widget shows after a recording stops:
 * "Uploading…" → "Processing…" → the result line for a few seconds → idle.
 * Kept in memory only; a stale phase (process restarted, upload hung) counts as idle.
 */
object WidgetState {
    enum class Phase { IDLE, UPLOADING, PROCESSING, RESULT }

    private const val RESULT_MS = 6_000L
    private const val BUSY_MAX_MS = 3 * 60_000L

    @Volatile private var phase = Phase.IDLE
    @Volatile private var since = 0L
    @Volatile var text: String = ""
        private set
    /** Note id of the last result, so tapping it opens that note. */
    @Volatile var noteId: String? = null
        private set

    private val main = Handler(Looper.getMainLooper())

    fun current(): Phase {
        val age = System.currentTimeMillis() - since
        return when (phase) {
            Phase.RESULT -> if (age < RESULT_MS) Phase.RESULT else Phase.IDLE
            Phase.UPLOADING, Phase.PROCESSING -> if (age < BUSY_MAX_MS) phase else Phase.IDLE
            Phase.IDLE -> Phase.IDLE
        }
    }

    fun uploading(ctx: Context) = set(ctx, Phase.UPLOADING, "Uploading…", null)

    fun processing(ctx: Context) {
        if (phase == Phase.UPLOADING) set(ctx, Phase.PROCESSING, "Processing…", null)
    }

    /** Show the outcome briefly, then go back to the (refreshed) list. */
    fun result(ctx: Context, line: String, id: String? = null) {
        set(ctx, Phase.RESULT, line, id)
        val app = ctx.applicationContext
        main.removeCallbacksAndMessages(this)
        main.postAtTime({ QuickToggleWidget.updateAll(app) }, this, android.os.SystemClock.uptimeMillis() + RESULT_MS + 100)
        // Also via WorkManager in case this process is gone by then
        WidgetRefreshWorker.settleLater(app, RESULT_MS + 1_000)
    }

    private fun set(ctx: Context, p: Phase, line: String, id: String?) {
        phase = p
        since = System.currentTimeMillis()
        text = line
        noteId = id
        QuickToggleWidget.updateAll(ctx.applicationContext)
    }
}
