package com.sanpan003.pocketarchive.quick

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.sanpan003.pocketarchive.MainActivity

/**
 * What the "Quick Record" launcher entries open (Samsung side key / Routines / Edge panel / S Pen / "Hey Google").
 * It used to be an alias of MainActivity, which made it the root of the app's task: any later restore of that task
 * (Recents, a process restart) delivered the same launcher intent again and recording started with nobody touching
 * the phone. Now it is its own throw-away activity — noHistory, excluded from Recents, never restored — and every
 * launch goes through [StartGate]: restored / re-created / from-history launches never start a recording.
 */
class QuickRecordLauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setShowWhenLocked(true)

        val referrerPkg = referrer?.host
        val screen = RecordingLog.screenNow(this)
        val gate = StartGate.decide(StartGate.Input(
            referrer = referrerPkg, ownPackage = packageName,
            fromHistory = intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0,
            recreated = savedInstanceState != null, staleAlias = false,
            screen = screen.state, justWoken = screen.justWoken,
        ))
        if (gate.verdict == StartGate.Verdict.BLOCK) {
            RecorderGuard.note("Blocked automatic start: ${gate.reason}")
            RecordingLog.blockedStart(this, RecordingLog.QUICK_RECORD, referrerPkg, gate.reason, screen)
            finish()
            return
        }

        when {
            RecorderState.recording -> whileRecording(referrerPkg)
            RecorderGuard.isEchoOfStop(this) -> {
                // Volume up stopped it in the app and the same press opened Quick Record: don't start again
                RecorderGuard.note("Quick Record launch right after a stop ignored (same press)")
                RecordingLog.ignoredStart(this, RecordingLog.QUICK_RECORD, referrerPkg, "Same key press as the stop just before")
            }
            else -> {
                val ready = QuickActions.start(this, RecordingLog.QUICK_RECORD, referrer = referrerPkg, screen = screen, requireConfirm = gate.verdict == StartGate.Verdict.CONFIRM)
                if (!ready) openApp("/quick") // needs mic permission or sign-in: the app handles it
            }
        }
        // Samsung's "Open app" expects to land in the app, as before (a plain route: it can never start a recording)
        if (!isFinishing) openApp("/quick")
        // Stay "foreground" for a moment while the recorder service promotes itself
        Handler(Looper.getMainLooper()).postDelayed({ finish() }, 300)
    }

    private fun whileRecording(referrerPkg: String?) {
        if (SystemClock.elapsedRealtime() - RecorderGuard.lastStartAt < RecorderGuard.STOP_KEY_GRACE_MS) {
            RecorderGuard.note("Quick Record launch right after the start ignored (same press)")
            RecordingLog.ignoredStart(this, RecordingLog.QUICK_RECORD, referrerPkg, "Same press that started the recording")
            return
        }
        when (RecorderPrefs.get(this).quickRecordWhileRecording) {
            RecorderPrefs.STOP -> { RecorderGuard.note("Quick Record while recording → stop & save"); QuickActions.stop(this) }
            RecorderPrefs.NEW -> { RecorderGuard.note("Quick Record while recording → new note"); QuickActions.restart(this, "quick-record") }
            else -> RecorderGuard.note("Quick Record while recording ignored (setting)")
        }
    }

    private var opened = false
    private fun openApp(route: String) {
        if (opened) return
        opened = true
        startActivity(
            Intent(this, MainActivity::class.java)
                .setAction(QuickActions.ACTION_OPEN_ROUTE)
                .putExtra(QuickActions.EXTRA_ROUTE, route)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }
}
