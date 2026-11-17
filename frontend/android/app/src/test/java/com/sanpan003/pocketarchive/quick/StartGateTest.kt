package com.sanpan003.pocketarchive.quick

import com.sanpan003.pocketarchive.quick.StartGate.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StartGateTest {
    private val own = "com.sanpan003.pocketarchive"

    private fun input(
        referrer: String? = "com.samsung.android.keycustomizationservice", screen: String = "on", justWoken: Boolean = false,
        fromHistory: Boolean = false, recreated: Boolean = false, staleAlias: Boolean = false, explicit: Boolean = false,
    ) = StartGate.Input(referrer, own, fromHistory, recreated, staleAlias, screen, justWoken, explicit)

    private fun verdict(i: StartGate.Input) = StartGate.decide(i).verdict

    // ── the bug: the phone's log shows starts reported as launched by the app itself, on a lit lock screen ──────────

    @Test fun launchedByTheAppItselfOnALockedScreenIsBlocked() {
        assertEquals(Verdict.BLOCK, verdict(input(referrer = own, screen = "locked")))
        assertEquals(Verdict.BLOCK, verdict(input(referrer = own, screen = "locked", justWoken = true)))
        assertEquals(Verdict.BLOCK, verdict(input(referrer = own, screen = "off")))
    }

    @Test fun restoredRecreatedOrFromHistoryNeverStarts() {
        assertEquals(Verdict.BLOCK, verdict(input(recreated = true)))
        assertEquals(Verdict.BLOCK, verdict(input(fromHistory = true)))
        assertEquals(Verdict.BLOCK, verdict(input(staleAlias = true)))
        // even a tap inside the app can't make a restored launch record
        assertEquals(Verdict.BLOCK, verdict(input(recreated = true, explicit = true)))
        assertEquals(Verdict.BLOCK, verdict(input(fromHistory = true, explicit = true)))
    }

    @Test fun allSuspectCombinationsBlockEvenWithAKnownSender() {
        for (ref in listOf("com.samsung.android.keycustomizationservice", "com.samsung.android.app.routineplus", "com.sec.android.app.launcher", "android", own, null, ""))
            for (screen in listOf("off", "locked", "on"))
                for (woken in listOf(true, false)) {
                    assertEquals(Verdict.BLOCK, verdict(input(ref, screen, woken, fromHistory = true)))
                    assertEquals(Verdict.BLOCK, verdict(input(ref, screen, woken, recreated = true)))
                    assertEquals(Verdict.BLOCK, verdict(input(ref, screen, woken, staleAlias = true)))
                }
    }

    // ── presses that must keep working ───────────────────────────────────────────────────────────────────────────

    @Test fun sideKeyAndRoutinesWorkWhenThePressWokeTheScreenOrThePhoneIsInUse() {
        assertEquals(Verdict.ALLOW, verdict(input(screen = "locked", justWoken = true)))   // side key on a dark phone
        assertEquals(Verdict.ALLOW, verdict(input(screen = "on")))                          // unlocked, in use
        assertEquals(Verdict.ALLOW, verdict(input(referrer = "com.samsung.android.app.routineplus", screen = "off")))
        assertEquals(Verdict.ALLOW, verdict(input(referrer = "com.sec.android.app.launcher", screen = "on")))
    }

    @Test fun aLitLockScreenOrAnUnknownSenderMustBeConfirmed() {
        assertEquals(Verdict.CONFIRM, verdict(input(screen = "locked", justWoken = false)))
        assertEquals(Verdict.CONFIRM, verdict(input(referrer = null)))
        assertEquals(Verdict.CONFIRM, verdict(input(referrer = "")))
        assertEquals(Verdict.CONFIRM, verdict(input(referrer = "android", screen = "locked")))
    }

    @Test fun anAppShortcutOnlyWorksOnAnUnlockedScreen() {
        assertEquals(Verdict.ALLOW, verdict(input(referrer = own, screen = "on")))
    }

    @Test fun ownGesturesInsideTheAppAreAllowed() {
        assertEquals(Verdict.ALLOW, verdict(input(referrer = own, screen = "locked", explicit = true)))
        assertEquals(Verdict.ALLOW, verdict(input(referrer = null, screen = "off", explicit = true)))
    }

    @Test fun everyBlockSaysWhy() {
        for (i in listOf(input(recreated = true), input(fromHistory = true), input(staleAlias = true), input(referrer = own, screen = "locked")))
            assertTrue(StartGate.decide(i).reason.isNotBlank())
    }
}
