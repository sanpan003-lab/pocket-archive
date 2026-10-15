package com.sanpan003.pocketarchive.wear

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the record screen shows. */
sealed class Phase {
    data object Idle : Phase()
    /** startedAt = SystemClock.elapsedRealtime() when recording began. */
    data class Recording(val startedAt: Long) : Phase()
    data object Sending : Phase()
    /** Handed to the phone; the server's answer comes back as [Result]. */
    data object Sent : Phase()
    data object Queued : Phase()
    data class Result(val icon: String, val text: String, val tone: String, val detail: String?) : Phase()
}

/**
 * In-memory state for the watch UI (record screen, queue count, mic level).
 * Results, queued and "sent" go back to Idle after a few seconds.
 */
object WatchState {
    private const val SHOW_MS = 4_000L

    private val _phase = MutableStateFlow<Phase>(Phase.Idle)
    val phase: StateFlow<Phase> = _phase.asStateFlow()

    private val _level = MutableStateFlow(0f)
    val level: StateFlow<Float> = _level.asStateFlow()

    private val _queued = MutableStateFlow(0)
    /** Recordings on the watch waiting for the phone. */
    val queued: StateFlow<Int> = _queued.asStateFlow()

    /** The app is on screen (results show in-app instead of as a notification). */
    @Volatile var visible = false

    private val main = Handler(Looper.getMainLooper())
    private val backToIdle = Runnable { _phase.value = Phase.Idle }

    fun set(phase: Phase) {
        main.removeCallbacks(backToIdle)
        _phase.value = phase
        when (phase) {
            is Phase.Result, Phase.Queued -> main.postDelayed(backToIdle, SHOW_MS)
            Phase.Sent -> main.postDelayed(backToIdle, SHOW_MS * 4) // the result normally arrives first
            else -> Unit
        }
    }

    fun level(value: Float) { _level.value = value }

    fun refreshQueue(ctx: Context) { _queued.value = CaptureQueue.count(ctx) }

    val isRecording get() = _phase.value is Phase.Recording
}
