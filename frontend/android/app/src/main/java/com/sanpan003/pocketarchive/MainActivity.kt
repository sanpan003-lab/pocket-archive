package com.sanpan003.pocketarchive

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import com.getcapacitor.BridgeActivity
import com.sanpan003.pocketarchive.quick.Notifications
import com.sanpan003.pocketarchive.quick.QuickActions
import com.sanpan003.pocketarchive.quick.QuickRecorderPlugin
import com.sanpan003.pocketarchive.quick.RecorderState
import com.sanpan003.pocketarchive.quick.TokenStore

class MainActivity : BridgeActivity() {

    /** Set by a START_RECORDING launch; recording starts once the activity is in the foreground. */
    private var startRecordingOnResume = false
    private var swallowKeyUp = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(QuickRecorderPlugin::class.java)
        super.onCreate(savedInstanceState)
        Notifications.ensureChannels(this)
        if (savedInstanceState == null) handleLaunch(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunch(intent)
    }

    override fun onResume() {
        super.onResume()
        if (startRecordingOnResume) {
            startRecordingOnResume = false
            QuickActions.start(this) // if not possible yet, /quick shows sign-in / permission
        }
    }

    /**
     * With the app on screen the volume keys reach the activity first:
     * down stops & uploads, up is ignored while recording. Otherwise the
     * recorder's media session handles them (screen off, other apps).
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (RecorderState.recording && TokenStore.volumeStop(this)) {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_DOWN -> {
                    if (event.repeatCount == 0) QuickActions.stop(this)
                    swallowKeyUp = keyCode
                    return true
                }
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    swallowKeyUp = keyCode
                    return true
                }
            }
        }
        return super.onKeyDown(keyCode, event)
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
        val isQuickRecordAlias = intent.component?.className?.endsWith(".QuickRecordLauncher") == true
        when {
            isQuickRecordAlias && RecorderState.recording && TokenStore.launcherToggle(this) -> {
                startRecordingOnResume = false
                QuickActions.stop(this)
                QuickRecorderPlugin.navigate("/quick")
            }
            intent.action == QuickActions.ACTION_START_RECORDING || isQuickRecordAlias -> {
                QuickRecorderPlugin.navigate("/quick")
                startRecordingOnResume = true
            }
            intent.action == QuickActions.ACTION_OPEN_INBOX -> QuickRecorderPlugin.navigate("/quick/inbox")
            intent.action == QuickActions.ACTION_OPEN_ROUTE ->
                intent.getStringExtra(QuickActions.EXTRA_ROUTE)?.let { QuickRecorderPlugin.navigate(it) }
        }
    }
}
