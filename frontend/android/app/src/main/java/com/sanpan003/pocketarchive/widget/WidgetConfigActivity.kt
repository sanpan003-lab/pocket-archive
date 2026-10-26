package com.sanpan003.pocketarchive.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import com.sanpan003.pocketarchive.quick.AppLock

/**
 * A widget's settings (2.10.0) — when it's added and from long-press → Settings. Each widget keeps its own.
 * Main widget: default filter, chips shown, actions, sort, density, theme, transparency, times, hide titles, Up next.
 * List widget: which list, theme, transparency, hide titles.
 */
class WidgetConfigActivity : AppCompatActivity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private lateinit var cfg: WidgetConfig
    private var isList = false
    private lateinit var root: LinearLayout

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        isList = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)?.provider?.className?.endsWith("PinnedListWidget") == true
        cfg = WidgetConfig.load(this, widgetId)
        title = if (isList) "List widget" else "Pocket Archive widget"

        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(16), dp(20), dp(24)) }
        setContentView(ScrollView(this).apply { addView(root) })
        heading(if (isList) "List widget" else "Pocket Archive widget", big = true)
        if (isList) listChooser() else mainOptions()
        lookOptions()
        root.addView(Button(this).apply {
            text = "Save"
            setOnClickListener { save() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) })
    }

    // ── Pieces ──────────────────────────────────────────────────────────────
    private fun heading(text: String, big: Boolean = false) = root.addView(TextView(this).apply {
        this.text = text
        setTypeface(typeface, Typeface.BOLD)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 20f else 13f)
        if (!big) { setTextColor(Color.parseColor("#8B5CF6")); isAllCaps = true }
        setPadding(0, dp(if (big) 4 else 18), 0, dp(6))
    })

    private fun hint(text: String) = root.addView(TextView(this).apply { this.text = text; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); alpha = 0.75f })

    private fun radios(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
        val group = RadioGroup(this)
        for ((value, label) in options) {
            group.addView(RadioButton(this).apply {
                text = label; id = View.generateViewId(); isChecked = value == selected; minHeight = dp(44)
                setOnCheckedChangeListener { _, on -> if (on) onPick(value) }
            })
        }
        root.addView(group)
    }

    private fun switch(label: String, on: Boolean, onChange: (Boolean) -> Unit) = root.addView(SwitchCompat(this).apply {
        text = label; isChecked = on; minHeight = dp(48)
        setOnCheckedChangeListener { _, v -> onChange(v) }
    })

    // ── Main widget ─────────────────────────────────────────────────────────
    private fun mainOptions() {
        heading("Opens on")
        radios(WidgetModel.FILTERS.filter { it != "actions" }.map { it to WidgetModel.FILTER_LABEL.getValue(it) }, cfg.defaultFilter) { cfg = cfg.copy(defaultFilter = it) }

        heading("Filter chips shown")
        for (f in WidgetModel.FILTERS.filter { it != "actions" }) {
            root.addView(CheckBox(this).apply {
                text = WidgetModel.FILTER_LABEL[f]; isChecked = f in cfg.chips; minHeight = dp(44)
                setOnCheckedChangeListener { _, on -> cfg = cfg.copy(chips = if (on) (cfg.chips + f).distinct() else cfg.chips - f) }
            })
        }
        switch("Show actions (alarms, timers…)", cfg.showActions) { cfg = cfg.copy(showActions = it, chips = if (it) (cfg.chips + "actions").distinct() else cfg.chips - "actions") }

        heading("Sort")
        radios(listOf("newest" to "Newest first", "due" to "Due soonest"), cfg.sort) { cfg = cfg.copy(sort = it) }

        heading("Rows")
        radios(listOf("comfortable" to "Comfortable (with list items to tick off)", "compact" to "Compact"), cfg.density) { cfg = cfg.copy(density = it) }
        switch("Show times", cfg.showTimes) { cfg = cfg.copy(showTimes = it) }
        switch("Up next (the next 3 reminders and events)", cfg.upNext) { cfg = cfg.copy(upNext = it) }
    }

    // ── List widget ─────────────────────────────────────────────────────────
    private fun listChooser() {
        heading("List")
        if (AppLock.isLocked(this)) {
            hint("Unlock Pocket Archive first — then come back to choose a list.")
            root.addView(Button(this).apply { text = "Open Pocket Archive"; setOnClickListener { WidgetActionActivity.openApp(this@WidgetConfigActivity, "/lists") } })
            return
        }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(box)
        box.addView(TextView(this).apply { text = "Loading your lists…"; alpha = 0.7f })
        Thread {
            val lists = WidgetModel.lists(WidgetSource.notes(applicationContext))
            runOnUiThread {
                box.removeAllViews()
                if (lists.isEmpty()) { box.addView(TextView(this).apply { text = "No lists yet — make one in the app (e.g. “I need milk and eggs from Publix”)." }); return@runOnUiThread }
                val group = RadioGroup(this)
                for (l in lists.take(60)) group.addView(RadioButton(this).apply {
                    text = "${l.icon} ${l.title}${l.progress?.let { "  ·  $it" } ?: ""}"; id = View.generateViewId(); minHeight = dp(44)
                    isChecked = l.id == cfg.listId
                    setOnCheckedChangeListener { _, on -> if (on) cfg = cfg.copy(listId = l.id) }
                })
                box.addView(group)
            }
        }.start()
    }

    // ── Both ────────────────────────────────────────────────────────────────
    private fun lookOptions() {
        heading("Theme")
        radios(listOf("system" to "Match the phone", "dark" to "Dark", "light" to "Light"), cfg.theme) { cfg = cfg.copy(theme = it) }
        heading("Background")
        val label = TextView(this).apply { text = "${cfg.opacity}% opaque" }
        root.addView(label)
        root.addView(SeekBar(this).apply {
            max = 100; progress = cfg.opacity; contentDescription = "Background transparency"
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, v: Int, fromUser: Boolean) { cfg = cfg.copy(opacity = v); label.text = "$v% opaque" }
                override fun onStartTrackingTouch(s: SeekBar?) = Unit
                override fun onStopTrackingTouch(s: SeekBar?) = Unit
            })
        })
        heading("Privacy")
        switch("Always hide titles", cfg.hideTitles) { cfg = cfg.copy(hideTitles = it) }
        hint("While the app is locked, titles are always hidden and changes open the app to unlock.")
        root.addView(View(this), LinearLayout.LayoutParams(1, dp(4)))
        root.gravity = Gravity.START
    }

    private fun save() {
        WidgetConfig.save(this, widgetId, cfg.copy(filter = cfg.defaultFilter))
        Widgets.refresh(applicationContext)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}
