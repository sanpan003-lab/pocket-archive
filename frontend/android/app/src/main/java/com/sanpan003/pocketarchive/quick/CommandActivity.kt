package com.sanpan003.pocketarchive.quick

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.NumberPicker
import android.widget.TextView
import android.widget.TimePicker
import android.widget.Toast
import org.json.JSONObject
import java.util.Calendar

/**
 * Behind the "Couldn't set your timer" notification. Transparent activity (so Android lets it open the Clock app):
 *  retry  → runs the command again right away
 *  manual → a number picker: hours / minutes / seconds for a timer, a time picker for an alarm,
 *           minutes-from-now for a reminder
 */
class CommandActivity : Activity() {
    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_KIND = "kind"
        const val EXTRA_JSON = "json"
        /** PhoneActions may open another app while this screen is up */
        @Volatile var visible = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(android.R.style.Theme_Translucent_NoTitleBar)
        val kind = intent.getStringExtra(EXTRA_KIND) ?: "timer"
        val cmd = runCatching { JSONObject(intent.getStringExtra(EXTRA_JSON) ?: "") }.getOrNull()
        if (intent.getStringExtra(EXTRA_MODE) == "retry" && cmd != null) { retry(cmd); return }
        manual(kind, cmd)
    }

    override fun onStart() { super.onStart(); visible = true }
    override fun onStop() { super.onStop(); visible = false }

    private fun done(text: String) {
        LocalCommands.confirm(this, text)
        androidx.core.app.NotificationManagerCompat.from(this).cancel(1012)
        finish()
    }

    private fun fail(kind: String, cmd: JSONObject?) {
        LocalCommands.failure(this, kind, cmd, "Still couldn't set your $kind")
        finish()
    }

    private fun retry(cmd: JSONObject) {
        val kind = cmd.optString("kind")
        val ok = when (kind) {
            "timer", "alarm" -> PhoneActions.run(this, cmd).optString("status").let { it == "done" || it == "tap" }
            "reminder" -> scheduleReminder(cmd)
            else -> false
        }
        if (ok) done("✔ ${kind.replaceFirstChar { it.uppercase() }} set") else fail(kind, cmd)
    }

    private fun scheduleReminder(cmd: JSONObject): Boolean {
        val delay = cmd.optLong("delayMs", -1)
        val at = if (delay > 0) System.currentTimeMillis() + delay else {
            val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, cmd.optInt("hour")); set(Calendar.MINUTE, cmd.optInt("minute")); set(Calendar.SECOND, 0) }
            if (c.timeInMillis <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
            c.timeInMillis
        }
        val text = cmd.optString("text").ifBlank { "Reminder" }
        val id = "local-manual-${System.currentTimeMillis()}"
        ReminderAlarms.schedule(this, ReminderAlarms.Reminder(id, text, text, at, "reminder"), "Set by hand after a failed quick command")
        return ReminderAlarms.status(this, id).optString("state") in setOf("set", "approx")
    }

    private fun picker(min: Int, max: Int, value: Int, unit: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        addView(NumberPicker(context).apply { minValue = min; maxValue = max; this.value = value.coerceIn(min, max); wrapSelectorWheel = true; tag = "n" })
        addView(TextView(context).apply { text = unit; gravity = Gravity.CENTER })
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    }

    private fun LinearLayout.pickerValue() = (findViewWithTag<NumberPicker>("n")).value

    private fun manual(kind: String, cmd: JSONObject?) {
        val pad = (16 * resources.displayMetrics.density).toInt()
        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(pad, pad, pad, 0) }
        var read: () -> JSONObject
        val title: String
        when (kind) {
            "alarm" -> {
                title = "Set an alarm"
                val tp = TimePicker(this).apply {
                    setIs24HourView(false)
                    hour = cmd?.optInt("hour", 7) ?: 7
                    minute = cmd?.optInt("minute", 0) ?: 0
                }
                body.addView(tp, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                read = { JSONObject().put("kind", "alarm").put("hour", tp.hour).put("minute", tp.minute).put("label", cmd?.optString("label") ?: "") }
            }
            "reminder" -> {
                title = "Remind me in…"
                val mins = picker(1, 720, ((cmd?.optLong("delayMs", 600_000) ?: 600_000) / 60_000).toInt().coerceAtLeast(1), "minutes from now")
                body.addView(mins)
                read = { JSONObject().put("kind", "reminder").put("text", cmd?.optString("text") ?: "Reminder").put("delayMs", mins.pickerValue() * 60_000L).put("hour", -1).put("minute", -1) }
            }
            else -> {
                title = "Set a timer"
                val total = cmd?.optInt("seconds", 600) ?: 600
                val h = picker(0, 23, total / 3600, "hours")
                val m = picker(0, 59, (total % 3600) / 60, "min")
                val s = picker(0, 59, total % 60, "sec")
                listOf(h, m, s).forEach { body.addView(it) }
                read = { JSONObject().put("kind", "timer").put("seconds", h.pickerValue() * 3600 + m.pickerValue() * 60 + s.pickerValue()).put("label", cmd?.optString("label") ?: "") }
            }
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(body)
            .setPositiveButton("Set") { _, _ ->
                val c = read()
                if (kind == "timer" && c.optInt("seconds") <= 0) { Toast.makeText(this, "Pick a time above zero", Toast.LENGTH_SHORT).show(); fail(kind, c); return@setPositiveButton }
                retry(c)
            }
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }
}
