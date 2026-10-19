package com.sanpan003.pocketarchive.quick

import android.content.Context
import java.util.concurrent.CopyOnWriteArraySet

/** Single source of truth for "is Quick Capture recording?" (widget, tile, app). */
object RecorderState {
    @Volatile var recording = false
        private set
    @Volatile var startedAt = 0L
        private set
    /** "Press again to confirm": volume up or a tap starts the recording */
    @Volatile var confirming = false

    private val stateListeners = CopyOnWriteArraySet<(Boolean) -> Unit>()
    private val levelListeners = CopyOnWriteArraySet<(Double) -> Unit>()

    fun addStateListener(listener: (Boolean) -> Unit) { stateListeners.add(listener) }
    fun removeStateListener(listener: (Boolean) -> Unit) { stateListeners.remove(listener) }
    fun addLevelListener(listener: (Double) -> Unit) { levelListeners.add(listener) }
    fun removeLevelListener(listener: (Double) -> Unit) { levelListeners.remove(listener) }

    fun update(ctx: Context, isRecording: Boolean, started: Long = 0L) {
        recording = isRecording
        startedAt = if (isRecording) started else 0L
        stateListeners.forEach { it(isRecording) }
        QuickToggleWidget.updateAll(ctx)
        QuickCaptureTileService.refresh(ctx)
    }

    /** Mic level 0..1 for the in-app pulse animation. */
    fun level(value: Double) {
        levelListeners.forEach { it(value) }
    }
}
