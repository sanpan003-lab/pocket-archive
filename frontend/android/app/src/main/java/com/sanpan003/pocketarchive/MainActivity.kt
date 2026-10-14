package com.sanpan003.pocketarchive

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.sanpan003.pocketarchive.quick.Notifications
import com.sanpan003.pocketarchive.quick.QuickActions
import com.sanpan003.pocketarchive.quick.QuickRecorderPlugin

class MainActivity : BridgeActivity() {

    /** Set by a START_RECORDING launch; recording starts once the activity is in the foreground. */
    private var startRecordingOnResume = false

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

    private fun handleLaunch(intent: Intent?) {
        intent ?: return
        // "Quick Record" launcher alias (e.g. Samsung side key → open app) behaves like START_RECORDING
        val isQuickRecordAlias = intent.component?.className?.endsWith(".QuickRecordLauncher") == true
        when {
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
