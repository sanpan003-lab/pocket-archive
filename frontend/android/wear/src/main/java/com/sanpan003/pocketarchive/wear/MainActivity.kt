package com.sanpan003.pocketarchive.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * Watch app: record screen ⇄ Recent ⇄ Errands. Opened by the launcher, the
 * "Quick Record" entry / tile / complication (EXTRA_RECORD: start recording
 * right away) or an arrival notification (EXTRA_ERRAND: open that checklist).
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val EXTRA_RECORD = "record"
        const val EXTRA_ERRAND = "errand"
        const val EXTRA_FROM = "from"   // tile | complication (the Quick Record launcher = the watch key)
    }

    private var startOnResume = false
    private var startSource = "app"
    private val micGranted = mutableStateOf(false)
    private val openErrand = mutableStateOf<String?>(null)
    /** tile | complication: waiting for the deliberate "hold to record" (HoldToRecord) */
    private val holdFor = mutableStateOf<String?>(null)

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        micGranted.value = hasMic()
        if (micGranted.value && startOnResume) {
            startOnResume = false
            WatchRecorderService.start(this, startSource)
        }
    }

    private fun hasMic() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchData.load(this)
        WatchPrefs.get(this)
        WatchNotifications.ensureChannels(this)
        CaptureQueue.recoverOrphans(this)
        WatchState.refreshQueue(this)
        // Over-the-air updates: finish a just-installed one, tell the phone our version, check daily
        WatchUpdater.afterStart(this)
        WatchUpdater.schedule(this)
        micGranted.value = hasMic()
        // A re-created activity (watch restarted the app, task restored) must never re-run the launch that created it
        handleIntent(intent, fresh = savedInstanceState == null)

        setContent {
            WatchApp(
                micGranted = micGranted.value,
                onRequestMic = ::requestMic,
                openErrand = openErrand.value,
                onErrandOpened = { openErrand.value = null },
            )
            holdFor.value?.let { from ->
                HoldToRecord(
                    from = from,
                    onConfirmed = { holdFor.value = null; startOnResume = false; if (micGranted.value) WatchRecorderService.start(this, from) else { startSource = from; startOnResume = true; requestMic() } },
                    onCancel = { holdFor.value = null; WatchStartLog.blocked(this, from, "Not held to confirm (tap only)") },
                )
            }
        }

        // Fresh notes/errands + the token for the direct-upload fallback
        lifecycleScope.launch {
            PhoneLink.loadState(this@MainActivity)
            PhoneLink.message(this@MainActivity, Protocol.MSG_SYNC_REQUEST)
            if (WatchTokenStore.get(this@MainActivity) == null) PhoneLink.message(this@MainActivity, Protocol.MSG_TOKEN_REQUEST)
        }
        if (CaptureQueue.count(this) > 0) SendWorker.sendNow(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent, fresh = true)
    }

    private fun handleIntent(intent: Intent?, fresh: Boolean) {
        intent ?: return
        val quickRecord = intent.component?.className?.endsWith(".QuickRecord") == true
        if (quickRecord || intent.getBooleanExtra(EXTRA_RECORD, false)) {
            startSource = intent.getStringExtra(EXTRA_FROM) ?: if (quickRecord) "key" else "app"
            // Hard rule: only a real press starts a recording. Restored / re-created / from-Recents launches never do.
            val fromHistory = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
            if (!fresh || fromHistory) {
                WatchStartLog.blocked(this, startSource, if (!fresh) "The app was restored or re-created (no new press)" else "Opened from Recents / a restored task (no new press)")
                return
            }
            // Tile and complication: a tap alone is not enough — hold the button for half a second
            if (!WatchState.isRecording && (startSource == "tile" || startSource == "complication")) {
                holdFor.value = startSource
                return
            }
            when {
                // The press that started it (e.g. a key also bound elsewhere): nothing to do
                WatchState.isRecording && WatchPrefs.justStarted() -> Unit
                WatchState.isRecording -> when (WatchPrefs.get(this).quickRecordWhileRecording) {
                    "stop" -> WatchRecorderService.stop(this)
                    "new" -> WatchRecorderService.restart(this, startSource)
                    else -> Unit
                }
                // Same press as the stop that just happened: don't start again
                WatchPrefs.justStopped(this) -> Unit
                else -> startOnResume = true
            }
        }
        intent.getStringExtra(EXTRA_ERRAND)?.let { openErrand.value = it }
    }

    override fun onResume() {
        super.onResume()
        WatchState.visible = true
        micGranted.value = hasMic()
        if (startOnResume) {
            if (micGranted.value) {
                startOnResume = false
                WatchRecorderService.start(this, startSource)
            } // otherwise the permission screen shows; recording starts after "Allow"
        }
    }

    override fun onPause() {
        WatchState.visible = false
        super.onPause()
    }

    private fun requestMic() {
        val perms = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    fun toggleRecording() = WatchRecorderService.toggle(this)
}
