package com.sanpan003.pocketarchive.quick

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the app lock asks again: every open / after 1 / 5 / 15 minutes in the background */
class AppLockTest {
    private val min = 60_000L
    private val t0 = 1_000_000L

    @Test fun neverInTheBackgroundNeverTimesOut() {
        for (m in AppLock.TIMEOUTS) assertFalse("timeout $m", AppLock.timedOut(0, t0 + 60 * min, m))
    }

    @Test fun everyOpenLocksAsSoonAsItLeaves() {
        assertTrue(AppLock.timedOut(t0, t0, 0))
        assertTrue(AppLock.timedOut(t0, t0 + 1, 0))
    }

    @Test fun afterOneMinute() {
        assertFalse(AppLock.timedOut(t0, t0 + min - 1, 1))
        assertTrue(AppLock.timedOut(t0, t0 + min, 1))
    }

    @Test fun afterFiveMinutesIsTheDefaultChoice() {
        assertFalse(AppLock.timedOut(t0, t0 + 4 * min + 59_000, 5))
        assertTrue(AppLock.timedOut(t0, t0 + 5 * min, 5))
    }

    @Test fun afterFifteenMinutes() {
        assertFalse(AppLock.timedOut(t0, t0 + 14 * min, 15))
        assertTrue(AppLock.timedOut(t0, t0 + 15 * min + 1, 15))
    }

    @Test fun onlyTheOffersInSettingsAreAllowed() {
        assertEquals(setOf(0, 1, 5, 15), AppLock.TIMEOUTS)
    }
}
