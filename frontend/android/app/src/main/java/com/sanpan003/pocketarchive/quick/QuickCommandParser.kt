package com.sanpan003.pocketarchive.quick

/**
 * Deterministic parser for spoken quick commands ("timer 10 minutes", "uh set an alarm for like six thirty",
 * "wake me at 5", "remind me in 20 minutes to call Mom"). Pure Kotlin: no Android, no network, no AI — it runs
 * on the phone (and the watch's copy) on the transcript the on-device speech recognizer produced.
 * Same file in the wear module (keep them in sync).
 *
 * It only accepts SHORT, command-shaped utterances; a long note that merely mentions a timer is left to the server.
 */
object QuickCommandParser {
    sealed interface Command {
        data class Timer(val seconds: Int, val label: String?) : Command
        /** [repeat]: MO..SU codes; hour/minute are 24 h */
        data class Alarm(val hour: Int, val minute: Int, val repeat: List<String>, val label: String?, val wake: Boolean = false) : Command
        data object Stopwatch : Command
        /** "remind me in 20 minutes …" ([delayMs]) or "… at 3 pm" ([hour]/[minute], next occurrence) */
        data class Reminder(val delayMs: Long?, val hour: Int?, val minute: Int?, val text: String) : Command
    }

    sealed interface Parse {
        data class Ok(val command: Command) : Parse
        /** Looks like a command of this kind but we couldn't get the numbers: never fail silently */
        data class Unclear(val kind: String) : Parse
        data object None : Parse
    }

    private const val MAX_WORDS = 18
    private const val MAX_TIMER_SECONDS = 24 * 3600

    // ── words → numbers ─────────────────────────────────────────────────────

    private val ONES = mapOf(
        "zero" to 0, "oh" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7, "eight" to 8,
        "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "thirteen" to 13, "fourteen" to 14, "fifteen" to 15, "sixteen" to 16,
        "seventeen" to 17, "eighteen" to 18, "nineteen" to 19,
    )
    private val TENS = mapOf("twenty" to 20, "thirty" to 30, "forty" to 40, "fourty" to 40, "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90)

    /** "twenty five" → 25, "one hundred twenty" → 120, "six thirty" stays "6 30", "one point five" → 1.5 */
    internal fun numberize(text: String): String {
        val tokens = text.split(' ').filter { it.isNotEmpty() }
        val out = ArrayList<String>()
        var i = 0
        while (i < tokens.size) {
            val t = tokens[i]
            val one = ONES[t]
            val ten = TENS[t]
            when {
                // "oh" is only a zero inside a time ("six oh five"); alone it is filler
                t == "oh" && !(out.lastOrNull()?.all { it.isDigit() } == true && tokens.getOrNull(i + 1)?.let { ONES[it] in 1..9 } == true) -> { i++ }
                ten != null -> {
                    val next = tokens.getOrNull(i + 1)?.let { ONES[it] }
                    if (next != null && next in 1..9) { out.add((ten + next).toString()); i += 2 } else { out.add(ten.toString()); i++ }
                }
                one != null -> {
                    if (tokens.getOrNull(i + 1) == "hundred") {
                        var v = one * 100
                        var used = 2
                        val rest = tokens.getOrNull(i + 2)
                        val restTen = rest?.let { TENS[it] }
                        val restOne = rest?.let { ONES[it] }
                        if (restTen != null) {
                            v += restTen; used = 3
                            val o2 = tokens.getOrNull(i + 3)?.let { ONES[it] }
                            if (o2 != null && o2 in 1..9) { v += o2; used = 4 }
                        } else if (restOne != null && restOne in 1..19) { v += restOne; used = 3 }
                        out.add(v.toString()); i += used
                    } else if (tokens.getOrNull(i + 1) == "point" && tokens.getOrNull(i + 2)?.let { ONES[it] } != null) {
                        out.add("$one.${ONES[tokens[i + 2]]}"); i += 3
                    } else { out.add(one.toString()); i++ }
                }
                t == "hundred" && out.isNotEmpty() && out.last().all { it.isDigit() } -> { out[out.size - 1] = (out.last().toInt() * 100).toString(); i++ }
                t == "a" && tokens.getOrNull(i + 1) == "hundred" -> { out.add("100"); i += 2 }
                else -> { out.add(t); i++ }
            }
        }
        return out.joinToString(" ")
    }

    // ── cleaning ────────────────────────────────────────────────────────────

    private val FILLERS = Regex(
        "\\b(?:uh+|um+|erm?|hmm+|ah+|eh|like|you know|i mean|basically|actually|just|please|kindly|hey|ok|okay|yeah|yes|so|well|right|alright|" +
            "can you|could you|would you|will you|can i|could i|i want you to|i need you to|i want to|i would like to|i'd like to|i'd like|i need to|go ahead and|for me|" +
            "pocket|assistant|now)\\b",
    )

    internal fun clean(raw: String): String {
        var s = raw.lowercase()
            .replace(Regex("\\b([ap])\\.?\\s?m\\.?(?=\\s|$|[.,!?])"), "$1m")
            .replace("o'clock", "oclock").replace("o’clock", "oclock")
            .replace(Regex("[’']"), "")
            .replace(Regex("[^a-z0-9:. ]+"), " ")
            .replace(Regex("(?<!\\d)\\.|\\.(?!\\d)"), " ")
        s = s.replace(Regex("\\s+"), " ").trim()
        s = FILLERS.replace(s, " ").replace(Regex("\\s+"), " ").trim()
        // "ten-minute" / "10min" / "5secs"
        s = s.replace(Regex("(\\d)(hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b"), "$1 $2")
        return numberize(s)
    }

    private val VERBS = setOf("set", "start", "make", "create", "add", "put", "wake", "get", "begin", "run", "schedule", "give", "remind")
    private val COMMAND_STARTERS = VERBS + setOf("timer", "alarm", "stopwatch", "countdown", "time", "reminder", "new", "a", "an")
    // Someone telling a story about a timer, not asking for one
    private val NOT_A_COMMAND = Regex("\\b(?:yesterday|last night|last week|never|didnt|wasnt|werent|isnt|doesnt|broke|broken|forgot)\\b")

    // ── durations ───────────────────────────────────────────────────────────

    private val UNIT = "(hours?|hrs?|minutes?|mins?|seconds?|secs?)"

    private fun unitSeconds(u: String) = when {
        u.startsWith("h") -> 3600.0
        u.startsWith("m") -> 60.0
        else -> 1.0
    }

    /** "1 hour 30 minutes", "90 seconds", "an hour and a half", "half an hour" → seconds, or null */
    internal fun durationSeconds(text: String): Double? {
        var s = " $text "
        s = s.replace(Regex(" (?:three quarters|3 quarters) of an hour "), " 45 minutes ")
            .replace(Regex(" (?:a )?(?:quarter of an hour|quarter hour) "), " 15 minutes ")
            .replace(Regex(" (?:half an hour|half hour|a half hour|half of an hour) "), " 30 minutes ")
            .replace(Regex(" (?:an|a|1) hour and a half "), " 90 minutes ")
            .replace(Regex(" (?:a|1) minute and a half "), " 90 seconds ")
            .replace(Regex(" (?:a )?couple (?:of )?minutes "), " 2 minutes ")
            .replace(Regex(" (?:a )?couple (?:of )?hours "), " 2 hours ")
            .replace(Regex(" (?:a )?couple (?:of )?seconds "), " 2 seconds ")
            .replace(Regex("(\\d+) and a half $UNIT"), "$1.5 $2")
            .replace(Regex("(\\d+) and (?:a )?half $UNIT"), "$1.5 $2")
        var total = 0.0
        var found = false
        for (m in Regex("(?<![\\d:])(\\d+(?:\\.\\d+)?|a|an)\\s+$UNIT\\b").findAll(s)) {
            val n = when (val q = m.groupValues[1]) { "a", "an" -> 1.0; else -> q.toDoubleOrNull() ?: continue }
            total += n * unitSeconds(m.groupValues[2])
            found = true
        }
        return if (found && total > 0) total else null
    }

    // ── clock times ─────────────────────────────────────────────────────────

    private data class Clock(val hour: Int, val minute: Int, val meridiem: String?)

    private val DAYS = mapOf("monday" to "MO", "tuesday" to "TU", "wednesday" to "WE", "thursday" to "TH", "friday" to "FR", "saturday" to "SA", "sunday" to "SU")

    private fun valid(h: Int, m: Int) = h in 0..24 && m in 0..59

    private fun clockTime(s: String): Clock? {
        val meridiemWord = when {
            Regex("\\b(?:am|in the morning|this morning|tomorrow morning|morning)\\b").containsMatchIn(s) -> "am"
            Regex("\\b(?:pm|in the afternoon|this afternoon|afternoon|in the evening|this evening|evening|tonight|at night)\\b").containsMatchIn(s) -> "pm"
            else -> null
        }
        if (Regex("\\bmidnight\\b").containsMatchIn(s)) return Clock(0, 0, "am")
        if (Regex("\\bnoon\\b").containsMatchIn(s)) return Clock(12, 0, "pm")
        Regex("\\bhalf past (\\d{1,2})\\b").find(s)?.let { return Clock(it.groupValues[1].toInt(), 30, meridiemWord) }
        Regex("\\bquarter past (\\d{1,2})\\b").find(s)?.let { return Clock(it.groupValues[1].toInt(), 15, meridiemWord) }
        Regex("\\bquarter (?:to|of|till) (\\d{1,2})\\b").find(s)?.let { val h = it.groupValues[1].toInt(); return Clock(if (h == 1) 12 else h - 1, 45, meridiemWord) }
        Regex("\\b(\\d{1,2}) (?:past|after) (\\d{1,2})\\b").find(s)?.let { if (valid(it.groupValues[2].toInt(), it.groupValues[1].toInt())) return Clock(it.groupValues[2].toInt(), it.groupValues[1].toInt(), meridiemWord) }
        Regex("\\b(\\d{1,2}) (?:to|till|of) (\\d{1,2})\\b").find(s)?.let { val h = it.groupValues[2].toInt(); val m = 60 - it.groupValues[1].toInt(); if (m in 1..59) return Clock(if (h == 1) 12 else h - 1, m, meridiemWord) }
        Regex("\\b(\\d{1,2}):(\\d{2})\\s*(am|pm)?").find(s)?.let { if (valid(it.groupValues[1].toInt(), it.groupValues[2].toInt())) return Clock(it.groupValues[1].toInt(), it.groupValues[2].toInt(), it.groups[3]?.value ?: meridiemWord) }
        Regex("\\b(\\d{1,2})\\s*(am|pm)\\b").find(s)?.let { if (it.groupValues[1].toInt() in 1..12) return Clock(it.groupValues[1].toInt(), 0, it.groupValues[2]) }
        Regex("\\b(\\d{1,2}) oclock\\b").find(s)?.let { if (it.groupValues[1].toInt() in 1..24) return Clock(it.groupValues[1].toInt(), 0, meridiemWord) }
        // "six thirty", "6 30 am", "seven oh five"
        Regex("\\b(?:at|for|to|alarm|me up)?\\s*(\\d{1,2}) (0?\\d|[1-5]\\d)\\b\\s*(am|pm)?").findAll(s).forEach {
            val h = it.groupValues[1].toInt(); val mi = it.groupValues[2].toInt()
            if (h in 1..24 && valid(h, mi) && !Regex("^\\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)").containsMatchIn(s.substring(it.range.last + 1))) return Clock(h, mi, it.groups[3]?.value ?: meridiemWord)
        }
        // "630", "0630", "1830"
        Regex("\\b(?:at|for|alarm|to) (\\d{1,2})(\\d{2})\\b").find(s)?.let { if (valid(it.groupValues[1].toInt(), it.groupValues[2].toInt())) return Clock(it.groupValues[1].toInt(), it.groupValues[2].toInt(), meridiemWord) }
        // bare hour: "wake me at 5", "alarm for 7"
        Regex("\\b(?:at|for|by|around) (\\d{1,2})(?! ?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|\\d))").find(s)?.let { if (it.groupValues[1].toInt() in 1..24) return Clock(it.groupValues[1].toInt(), 0, meridiemWord) }
        return null
    }

    /** Resolve to 24 h. No am/pm: the next occurrence from [nowMinuteOfDay] (a wake-up prefers the morning). */
    private fun resolve(c: Clock, nowMinuteOfDay: Int, wake: Boolean): Pair<Int, Int> {
        val h = c.hour
        if (h == 24) return 0 to c.minute
        if (c.meridiem == "am") return (h % 12) to c.minute
        if (c.meridiem == "pm") return (h % 12 + 12) to c.minute
        if (h == 0 || h >= 13) return h to c.minute
        val am = (h % 12) to c.minute
        val pm = (h % 12 + 12) to c.minute
        if (wake && h != 12) return am
        fun wait(p: Pair<Int, Int>): Int { val d = p.first * 60 + p.second - nowMinuteOfDay; return if (d <= 0) d + 24 * 60 else d }
        return if (wait(am) <= wait(pm)) am else pm
    }

    private fun repeatDays(s: String): List<String> = when {
        Regex("\\b(?:every day|everyday|daily|each day)\\b").containsMatchIn(s) -> listOf("MO", "TU", "WE", "TH", "FR", "SA", "SU")
        Regex("\\b(?:weekdays|every weekday|monday (?:through|to|thru) friday)\\b").containsMatchIn(s) -> listOf("MO", "TU", "WE", "TH", "FR")
        Regex("\\b(?:weekends|every weekend)\\b").containsMatchIn(s) -> listOf("SA", "SU")
        else -> DAYS.entries.filter { Regex("\\bevery ${it.key}s?\\b").containsMatchIn(s) }.map { it.value }
    }

    private val LABEL_STOP = setOf(
        "set", "start", "make", "create", "add", "put", "a", "an", "the", "my", "timer", "timers", "alarm", "for", "to", "me", "it", "on", "of", "up", "wake", "get",
        "countdown", "count", "down", "new", "in", "at", "and", "called", "named", "labeled", "labelled", "label", "tomorrow", "today", "every", "day", "daily",
    )

    private fun label(rest: String): String? {
        val words = rest.split(' ').filter { it.isNotBlank() && it !in LABEL_STOP && !it.first().isDigit() && !Regex("^(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|am|pm|oclock)$").matches(it) }
        if (words.isEmpty() || words.size > 3) return null
        return words.joinToString(" ").replaceFirstChar { it.uppercase() }
    }

    // ── entry point ─────────────────────────────────────────────────────────

    /** [nowMinuteOfDay]: minutes since local midnight (to choose between 6:30 AM and PM) */
    fun parse(raw: String, nowMinuteOfDay: Int): Parse {
        val s = clean(raw)
        if (s.isBlank()) return Parse.None
        val words = s.split(' ')
        if (words.size > MAX_WORDS) return Parse.None
        val hasTimer = Regex("\\b(?:timers?|count ?down|time me)\\b").containsMatchIn(s)
        val hasAlarm = Regex("\\balarms?\\b|\\bwake me(?: up)?\\b|\\bget me up\\b|\\bwake up\\b").containsMatchIn(s)
        val hasStopwatch = Regex("\\bstop ?watch\\b").containsMatchIn(s)
        val hasRemind = Regex("\\bremind me\\b|\\bset (?:a |an )?reminder\\b").containsMatchIn(s)
        if (!hasTimer && !hasAlarm && !hasStopwatch && !hasRemind) return Parse.None
        // A note that only mentions a timer ("the oven timer is broken") is not a command
        if (NOT_A_COMMAND.containsMatchIn(s)) return Parse.None
        if (words.take(4).none { it in COMMAND_STARTERS || it.first().isDigit() } && !hasRemind) return Parse.None
        // No numbers found: only a clear request ("set a timer") is worth a "couldn't set it" alert, not a sentence about timers
        val request = words.take(3).any { it in VERBS } || words.size <= 4
        fun unclear(kind: String): Parse = if (request) Parse.Unclear(kind) else Parse.None

        if (hasRemind) return parseReminder(s, nowMinuteOfDay)
        if (hasStopwatch && !hasTimer && !hasAlarm) return Parse.Ok(Command.Stopwatch)

        val duration = durationSeconds(s)
        if (hasTimer && !(hasAlarm && duration == null)) {
            if (duration != null) {
                val sec = Math.round(duration).toInt()
                if (sec < 1 || sec > MAX_TIMER_SECONDS) return unclear("timer")
                return Parse.Ok(Command.Timer(sec, label(Regex("(\\d+(?:\\.\\d+)?|a|an)\\s+$UNIT").replace(s, " "))))
            }
            // "timer ten" → minutes
            Regex("\\b(?:for|timer|to) (\\d{1,3})\\b(?!:)").find(s)?.let {
                val n = it.groupValues[1].toInt()
                if (n in 1..180) return Parse.Ok(Command.Timer(n * 60, null))
            }
            return unclear("timer")
        }
        if (hasAlarm) {
            val wake = Regex("\\bwake me\\b|\\bget me up\\b|\\bwake up\\b").containsMatchIn(s)
            val repeat = repeatDays(s)
            // "alarm in 10 minutes"
            if (Regex("\\bin \\d").containsMatchIn(s) && duration != null && clockTime(s.replace(Regex("(\\d+(?:\\.\\d+)?|a|an)\\s+$UNIT"), " ")) == null) {
                val at = (nowMinuteOfDay + Math.ceil(duration / 60.0).toInt()) % (24 * 60)
                return Parse.Ok(Command.Alarm(at / 60, at % 60, repeat, null))
            }
            val c = clockTime(s) ?: return unclear("alarm")
            val (h, m) = resolve(c, nowMinuteOfDay, wake)
            val lbl = Regex("\\b(?:called|named|labeled|labelled|label) ([a-z ]{2,24})$").find(s)?.groupValues?.get(1)?.trim()?.replaceFirstChar { it.uppercase() }
            return Parse.Ok(Command.Alarm(h, m, repeat, lbl, wake))
        }
        return Parse.None
    }

    private fun parseReminder(s: String, nowMinuteOfDay: Int): Parse {
        val text = Regex("\\bremind me (?:in [^ ]+ [^ ]+(?: and [^ ]+ [^ ]+)? |at [^ ]+(?: am| pm)? |tomorrow |tonight )?(?:to |that |about )?(.+)$").find(s)?.groupValues?.get(1)
            ?.replace(Regex("\\b(?:in )?(?:\\d+(?:\\.\\d+)?|a|an) $UNIT\\b"), " ")?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
        val title = text.ifBlank { "Reminder" }.replaceFirstChar { it.uppercase() }
        val rel = if (Regex("\\bin (?:\\d|a |an |half|quarter|a couple)").containsMatchIn(s)) durationSeconds(s) else null
        if (rel != null) {
            val ms = Math.round(rel * 1000)
            return if (ms in 1000..(48L * 3600_000)) Parse.Ok(Command.Reminder(ms, null, null, title)) else Parse.Unclear("reminder")
        }
        val c = clockTime(s) ?: return Parse.None // "remind me to buy milk": an ordinary note, the server handles it
        val (h, m) = resolve(c, nowMinuteOfDay, wake = false)
        return Parse.Ok(Command.Reminder(null, h, m, title))
    }
}
