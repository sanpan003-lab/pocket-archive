package com.sanpan003.pocketarchive.quick

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Optional built-in shortcuts (Settings → Recording & shortcuts, default off):
 * double-press volume up = start recording, double-press volume down = stop.
 *
 * Never gets in the way of normal volume use: the first press always goes
 * through untouched; only a second press within DOUBLE_MS is used, and the
 * volume step of the first press is undone. Holding a key (repeat) is never
 * used. Works while the screen is on and unlocked (Android doesn't send keys
 * to accessibility services otherwise) — screen off: Samsung Routines / side key.
 * Same double-action guards as every other start/stop.
 */
class VolumeShortcutService : AccessibilityService() {

    companion object {
        private const val DOUBLE_MS = 400L

        fun isEnabled(ctx: Context): Boolean {
            val me = ComponentName(ctx, VolumeShortcutService::class.java).flattenToString()
            val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return list.split(':').any { it.equals(me, ignoreCase = true) }
        }

        /** Turn off from the app (Android 7+: the service can disable itself) */
        @Volatile var instance: VolumeShortcutService? = null
            private set
    }

    private var lastKey = 0
    private var lastDownAt = 0L

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    fun turnOff() = disableSelf()

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) return false
        if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount > 0) return false
        val s = RecorderPrefs.get(this)
        val wanted = (code == KeyEvent.KEYCODE_VOLUME_UP && s.doublePressUpStart) ||
            (code == KeyEvent.KEYCODE_VOLUME_DOWN && s.doublePressDownStop)
        if (!wanted) return false

        val now = SystemClock.uptimeMillis()
        val double = lastKey == code && now - lastDownAt <= DOUBLE_MS
        lastKey = code
        lastDownAt = now
        if (!double) return false              // single press: normal volume
        lastKey = 0

        val recording = RecorderState.recording
        when {
            code == KeyEvent.KEYCODE_VOLUME_UP && !recording -> {
                if (!RecorderGuard.canStart(this, "double-press")) return false
                undoFirstStep(AudioManager.ADJUST_LOWER)
                RecorderGuard.note("Double-press volume up → start")
                // Microphone services may only start from the foreground: the invisible trampoline does it
                startActivity(Intent(this, RecordTrampolineActivity::class.java)
                    .setAction(QuickActions.ACTION_START_RECORDING)
                    .putExtra(RecordTrampolineActivity.EXTRA_FROM, RecordingLog.VOLUME_KEYS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            }
            code == KeyEvent.KEYCODE_VOLUME_DOWN && recording -> {
                if (!RecorderGuard.canStopByKey()) return false
                RecorderGuard.note("Double-press volume down → stop & save")
                QuickActions.stop(this) // the recording's media session already kept the first press from changing the volume
                return true
            }
        }
        return false
    }

    /** The first press of the double already changed the volume one step: put it back */
    private fun undoFirstStep(direction: Int) {
        runCatching {
            getSystemService(AudioManager::class.java)
                ?.adjustSuggestedStreamVolume(direction, AudioManager.USE_DEFAULT_STREAM_TYPE, 0)
        }
    }
}
