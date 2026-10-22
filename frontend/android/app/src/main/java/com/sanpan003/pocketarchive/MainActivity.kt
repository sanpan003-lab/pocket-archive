package com.sanpan003.pocketarchive

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import com.getcapacitor.BridgeActivity
import com.sanpan003.pocketarchive.quick.Notifications
import com.sanpan003.pocketarchive.quick.QuickActions
import com.sanpan003.pocketarchive.quick.QuickRecorderPlugin
import com.sanpan003.pocketarchive.quick.RecorderGuard
import com.sanpan003.pocketarchive.quick.RecorderKeys
import com.sanpan003.pocketarchive.quick.RecorderPrefs
import com.sanpan003.pocketarchive.quick.RecorderState
import com.sanpan003.pocketarchive.quick.DiscardStore

class MainActivity : BridgeActivity() {

    /** Set by a START_RECORDING launch; recording starts once the activity is in the foreground. */
    private var startRecordingOnResume = false
    /** Who launched Quick Record and how the screen was at that moment (for the recording log) */
    private var launchReferrer: String? = null
    private var launchScreen: com.sanpan003.pocketarchive.quick.RecordingLog.Screen? = null
    private var swallowKeyUp = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(QuickRecorderPlugin::class.java)
        super.onCreate(savedInstanceState)
        Notifications.ensureChannels(this)
        DiscardStore.cleanup(this)
        com.sanpan003.pocketarchive.quick.PocketCheck.watchScreen(this)
        if (savedInstanceState == null) handleLaunch(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunch(intent)
    }

    override fun onResume() {
        super.onResume()
        com.sanpan003.pocketarchive.quick.ErrandSync.onAppResumed(this) // location permission changed → re-arm geofences
        if (startRecordingOnResume) {
            startRecordingOnResume = false
            QuickActions.start(this, "quick-record", referrer = launchReferrer, screen = launchScreen) // if not possible yet, /quick shows sign-in / permission
        }
    }

    /**
     * With the app on screen the volume keys reach the activity first.
     * Settings → Recording & shortcuts → Test: report keys instead of acting.
     * While recording: what the key does comes from RecorderKeys (stop / discard / ignore);
     * otherwise the media session handles them (screen off, other apps).
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val volume = keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP
        if (volume && QuickRecorderPlugin.keyTestActive) {
            if (event.repeatCount == 0) {
                event.startTracking()
                QuickRecorderPlugin.reportKey(keyCode, long = false)
            }
            swallowKeyUp = keyCode
            return true
        }
        // "Press again to confirm": volume up starts the waiting recording
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP && RecorderState.confirming) {
            startService(com.sanpan003.pocketarchive.quick.QuickRecorderService.intent(this, com.sanpan003.pocketarchive.quick.QuickRecorderService.ACTION_CONFIRM))
            swallowKeyUp = keyCode
            return true
        }
        if (volume && RecorderState.recording && RecorderPrefs.get(this).capturesKeys) {
            RecorderKeys.onKey(this, if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) RecorderKeys.Key.UP else RecorderKeys.Key.DOWN)
            swallowKeyUp = keyCode
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (QuickRecorderPlugin.keyTestActive && (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP)) {
            QuickRecorderPlugin.reportKey(keyCode, long = true)
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    /** The matching key-up of a press handled above (no volume change, no click sound). */
    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == swallowKeyUp) {
            swallowKeyUp = 0
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    private fun handleLaunch(intent: Intent?) {
        intent ?: return
        // "Quick Record" launcher alias (e.g. Samsung side key → open app) behaves like START_RECORDING,
        // and stops a running recording instead when that setting is on
        val isQuickRecordAlias = intent.component?.className?.contains(".QuickRecordLauncher") == true // any tile
        val wantsRecording = intent.action == QuickActions.ACTION_START_RECORDING || isQuickRecordAlias
        if (wantsRecording) {
            launchReferrer = referrer?.host
            launchScreen = com.sanpan003.pocketarchive.quick.RecordingLog.screenNow(this)
        }
        when {
            wantsRecording && RecorderState.recording -> {
                startRecordingOnResume = false
                QuickRecorderPlugin.navigate("/quick")
                // The press that started this recording (routine echo): nothing to do
                if (android.os.SystemClock.elapsedRealtime() - RecorderGuard.lastStartAt < RecorderGuard.STOP_KEY_GRACE_MS) {
                    RecorderGuard.note("Quick Record launch right after the start ignored (same press)")
                    com.sanpan003.pocketarchive.quick.RecordingLog.ignoredStart(this, "quick-record", launchReferrer, "Same press that started the recording")
                    return
                }
                when (RecorderPrefs.get(this).quickRecordWhileRecording) {
                    RecorderPrefs.STOP -> { RecorderGuard.note("Quick Record while recording → stop & save"); QuickActions.stop(this) }
                    RecorderPrefs.NEW -> { RecorderGuard.note("Quick Record while recording → new note"); QuickActions.restart(this, "quick-record") }
                    else -> RecorderGuard.note("Quick Record while recording ignored (setting)")
                }
            }
            wantsRecording && RecorderGuard.isEchoOfStop(this) -> {
                // Volume up stopped it in the app and the same press opened Quick Record: don't start again
                RecorderGuard.note("Quick Record launch right after a stop ignored (same press)")
                com.sanpan003.pocketarchive.quick.RecordingLog.ignoredStart(this, "quick-record", launchReferrer, "Same key press as the stop just before")
                QuickRecorderPlugin.navigate("/quick")
            }
            wantsRecording -> {
                QuickRecorderPlugin.navigate("/quick")
                startRecordingOnResume = true
            }
            intent.action == QuickActions.ACTION_OPEN_INBOX -> QuickRecorderPlugin.navigate("/quick/inbox")
            intent.action == QuickActions.ACTION_OPEN_ROUTE ->
                intent.getStringExtra(QuickActions.EXTRA_ROUTE)?.let { QuickRecorderPlugin.navigate(it) }
        }
    }
}
