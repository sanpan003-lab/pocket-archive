package com.sanpan003.pocketarchive.quick

import com.sanpan003.pocketarchive.quick.QuickCommandParser.Command
import com.sanpan003.pocketarchive.quick.QuickCommandParser.Parse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickCommandParserTest {
    private val nineAm = 9 * 60

    private fun parse(text: String, now: Int = nineAm) = QuickCommandParser.parse(text, now)
    private fun command(text: String, now: Int = nineAm): Command = (parse(text, now) as? Parse.Ok)?.command ?: error("Not a command: \"$text\" → ${parse(text, now)}")
    private fun timer(text: String, seconds: Int, label: String? = null) {
        val c = command(text) as? Command.Timer ?: error("Not a timer: \"$text\" → ${command(text)}")
        assertEquals("\"$text\" seconds", seconds, c.seconds)
        if (label != null) assertEquals("\"$text\" label", label, c.label)
    }
    private fun alarm(text: String, h: Int, m: Int, now: Int = nineAm, repeat: List<String>? = null) {
        val c = command(text, now) as? Command.Alarm ?: error("Not an alarm: \"$text\" → ${command(text, now)}")
        assertEquals("\"$text\" time", "%02d:%02d".format(h, m), "%02d:%02d".format(c.hour, c.minute))
        if (repeat != null) assertEquals("\"$text\" repeat", repeat, c.repeat)
    }

    // ── timers ──────────────────────────────────────────────────────────────

    @Test fun timersPlain() {
        timer("timer 10 minutes", 600)
        timer("set a timer for 10 minutes", 600)
        timer("Set a timer for ten minutes.", 600)
        timer("SET A TIMER FOR TEN MINUTES", 600)
        timer("set a timer, for, ten minutes", 600)
        timer("start a timer for 5 minutes", 300)
        timer("set timer 3 minutes", 180)
        timer("set a timer for 10 mins", 600)
        timer("set a timer for 2 hours", 7200)
        timer("set a timer for 45 seconds", 45)
        timer("set a timer for 90 seconds", 90)
        timer("set a timer for a minute", 60)
    }

    @Test fun timersSpokenNumbers() {
        timer("timer twenty five minutes", 1500)
        timer("timer for one hour thirty minutes", 5400)
        timer("set a timer for one hundred twenty minutes", 7200)
        timer("set a timer for fifteen minutes", 900)
        timer("set a timer for ninety seconds", 90)
        timer("timer for two hours and fifteen minutes", 8100)
    }

    @Test fun timersFractions() {
        timer("set a timer for an hour and a half", 5400)
        timer("timer for half an hour", 1800)
        timer("set a timer for two and a half minutes", 150)
        timer("timer for a quarter of an hour", 900)
        timer("set a timer for a couple of minutes", 120)
        timer("set a timer for one point five hours", 5400)
        timer("timer for three quarters of an hour", 2700)
    }

    @Test fun timersFillersAndAccents() {
        timer("uh set a timer for like ten minutes", 600)
        timer("um could you set a timer for ten min", 600)
        timer("hey pocket set a timer for fifteen minutes", 900)
        timer("okay so uh timer ten minutes please", 600)
        timer("yeah just set a timer for five minutes", 300)
        timer("can you please start a ten minute timer", 600)
        timer("I'd like to set a timer for twenty minutes", 1200)
        timer("erm set the timer for ten minutes", 600)
        timer("10 minute timer", 600)
        timer("ten-minute timer please", 600)
        timer("start countdown 20 minutes", 1200)
        timer("timer ten", 600) // a bare number is minutes
    }

    @Test fun timerLabel() {
        timer("set a timer for ten minutes for the pasta", 600, "Pasta")
        timer("set a timer for 20 minutes for laundry", 1200, "Laundry")
    }

    // ── alarms ──────────────────────────────────────────────────────────────

    @Test fun alarmsExplicitMeridiem() {
        alarm("set an alarm for 6:30 am", 6, 30)
        alarm("alarm 7 am", 7, 0)
        alarm("set alarm for seven fifteen pm", 19, 15)
        alarm("set an alarm for 5 pm every weekday", 17, 0, repeat = listOf("MO", "TU", "WE", "TH", "FR"))
        alarm("set an alarm for eight oclock tomorrow morning", 8, 0)
        alarm("set an alarm for 6:30 a.m.", 6, 30)
        alarm("set an alarm for 6:30 p.m.", 18, 30)
        alarm("alarm for ten thirty in the evening", 22, 30)
    }

    @Test fun alarmsNextOccurrence() {
        alarm("set an alarm for six thirty", 18, 30, now = 9 * 60)
        alarm("set an alarm for six thirty", 6, 30, now = 3 * 60)
        alarm("set an alarm for 6 oclock", 18, 0, now = 9 * 60)
        alarm("set an alarm for half past six", 18, 30, now = 9 * 60)
        alarm("alarm for quarter to seven", 18, 45, now = 9 * 60)
        alarm("set an alarm for 630", 18, 30, now = 9 * 60)
        alarm("set an alarm for 14:45", 14, 45)
    }

    @Test fun alarmsWakeMe() {
        alarm("wake me at 5", 5, 0)
        alarm("wake me up at five thirty in the morning", 5, 30)
        alarm("wake me up at 6 every monday", 6, 0, repeat = listOf("MO"))
        alarm("uh wake me at like six", 6, 0, now = 22 * 60)
        alarm("wake me up at seven tomorrow", 7, 0, now = 23 * 60)
    }

    @Test fun alarmsSpecialTimes() {
        alarm("set an alarm for noon", 12, 0)
        alarm("set an alarm for midnight", 0, 0)
        alarm("set an alarm in 10 minutes", 9, 10)
        alarm("set a daily alarm for 7 am", 7, 0, repeat = listOf("MO", "TU", "WE", "TH", "FR", "SA", "SU"))
        alarm("set an alarm for weekends at 9 am", 9, 0, repeat = listOf("SA", "SU"))
    }

    // ── reminders and stopwatch ─────────────────────────────────────────────

    @Test fun reminders() {
        var r = command("remind me in 20 minutes") as Command.Reminder
        assertEquals(20 * 60_000L, r.delayMs); assertEquals("Reminder", r.text)
        r = command("remind me in 20 minutes to call mom") as Command.Reminder
        assertEquals(20 * 60_000L, r.delayMs); assertEquals("Call mom", r.text)
        r = command("remind me in two minutes to check the oven") as Command.Reminder
        assertEquals(120_000L, r.delayMs); assertEquals("Check the oven", r.text)
        r = command("remind me in an hour and a half to leave") as Command.Reminder
        assertEquals(5_400_000L, r.delayMs)
        r = command("uh remind me in like ten minutes to move the car") as Command.Reminder
        assertEquals(600_000L, r.delayMs)
        r = command("remind me at 3 pm to take pills") as Command.Reminder
        assertEquals(15, r.hour); assertEquals(0, r.minute); assertEquals("Take pills", r.text)
    }

    @Test fun stopwatch() {
        assertEquals(Command.Stopwatch, command("start the stopwatch"))
        assertEquals(Command.Stopwatch, command("stopwatch"))
    }

    // ── not commands / unclear ──────────────────────────────────────────────

    @Test fun ordinaryNotesAreLeftToTheServer() {
        assertEquals(Parse.None, parse("remind me to buy milk"))
        assertEquals(Parse.None, parse("buy milk and eggs tomorrow"))
        assertEquals(Parse.None, parse("the oven timer is broken again"))
        assertEquals(Parse.None, parse("I set a timer yesterday and it never rang"))
        assertEquals(Parse.None, parse("dentist appointment tuesday at 3 pm"))
        assertEquals(Parse.None, parse(""))
        assertEquals(Parse.None, parse("so today I was thinking about the timer on the oven and how we should set a timer for ten minutes maybe later on when we cook dinner tonight because it keeps burning"))
    }

    @Test fun unclearCommandsAreNeverSilent() {
        assertEquals(Parse.Unclear("timer"), parse("set a timer"))
        assertEquals(Parse.Unclear("alarm"), parse("set an alarm"))
        assertEquals(Parse.Unclear("timer"), parse("set a timer for forty eight hours"))
        assertEquals(Parse.Unclear("alarm"), parse("wake me up"))
    }

    // ── server failures: the command still runs once, on the phone ──────────

    private class MemoryStore : CommandClaims.Store {
        val map = HashMap<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String) { map[key] = value }
    }

    @Test fun serverDownLocalRunsAnyway() {
        // transcription timed out / offline / 5xx: the server never answers, the local claim is free
        val claims = CommandClaims(MemoryStore())
        assertTrue(claims.claim("c1", "local"))
        assertEquals("local", claims.claimedBy("c1"))
    }

    @Test fun serverAnswersFirstLocalSkips() {
        val claims = CommandClaims(MemoryStore())
        assertTrue(claims.claim("c2", "server"))
        assertFalse(claims.claim("c2", "local"))
    }

    @Test fun localFirstServerSkipsDuplicate() {
        val claims = CommandClaims(MemoryStore())
        assertTrue(claims.claim("c3", "local"))
        assertFalse(claims.claim("c3", "server")) // no second timer
    }

    @Test fun failedLocalAttemptHandsBackToServer() {
        val claims = CommandClaims(MemoryStore())
        assertTrue(claims.claim("c4", "local"))
        claims.release("c4", "local") // Clock refused: let the server's copy try
        assertNull(claims.claimedBy("c4"))
        assertTrue(claims.claim("c4", "server"))
    }

    @Test fun recordingsWithoutAnIdAreNeverBlocked() {
        val claims = CommandClaims(MemoryStore())
        assertTrue(claims.claim("", "local"))
        assertTrue(claims.claim("", "server"))
    }
}
