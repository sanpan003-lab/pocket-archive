package com.sanpan003.pocketarchive.widget

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import com.sanpan003.pocketarchive.MainActivity
import com.sanpan003.pocketarchive.quick.AppLock
import com.sanpan003.pocketarchive.quick.QuickActions

/**
 * Taps on the widgets that aren't plain buttons (2.10.0): filter chips, a row (opens the note), tick an item, Done,
 * Snooze, and the small text box for "Type a note" / "+ Add item". Invisible; it never shows the app unless asked to.
 * App locked: changes open the app instead (unlock first) — the widget never changes notes while it's locked.
 */
class WidgetActionActivity : Activity() {
    companion object {
        const val EXTRA_KIND = "kind"            // chip | open | toggle | done | snooze | text | addItem
        const val EXTRA_WIDGET = AppWidgetManager.EXTRA_APPWIDGET_ID
        const val EXTRA_NOTE = "noteId"
        const val EXTRA_ITEM = "itemId"
        const val EXTRA_FILTER = "filter"

        fun intent(ctx: Context, kind: String, widgetId: Int, noteId: String? = null, filter: String? = null): Intent =
            Intent(ctx, WidgetActionActivity::class.java).putExtra(EXTRA_KIND, kind).putExtra(EXTRA_WIDGET, widgetId)
                .apply { if (noteId != null) putExtra(EXTRA_NOTE, noteId); if (filter != null) putExtra(EXTRA_FILTER, filter) }
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)

        fun openApp(ctx: Context, route: String) {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).setAction(QuickActions.ACTION_OPEN_ROUTE)
                .putExtra(QuickActions.EXTRA_ROUTE, route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kind = intent.getStringExtra(EXTRA_KIND) ?: return finish()
        val widgetId = intent.getIntExtra(EXTRA_WIDGET, AppWidgetManager.INVALID_APPWIDGET_ID)
        val noteId = intent.getStringExtra(EXTRA_NOTE)
        val itemId = intent.getStringExtra(EXTRA_ITEM)
        val app = applicationContext

        when (kind) {
            "chip" -> {
                val filter = intent.getStringExtra(EXTRA_FILTER) ?: "all"
                WidgetConfig.save(app, widgetId, WidgetConfig.load(app, widgetId).copy(filter = filter))
                Widgets.refresh(app)
                finish()
            }
            "open" -> { openApp(this, if (noteId != null) "/quick/$noteId" else "/quick/inbox"); finish() }
            "toggle", "done", "snooze" -> {
                if (AppLock.isLocked(app)) { openApp(this, if (noteId != null) "/quick/$noteId" else "/quick/inbox"); finish(); return }
                finish()
                Thread { report(app, WidgetActions.run(app, kind, noteId, itemId, null)) }.start()
            }
            "text", "addItem" -> {
                if (AppLock.isLocked(app)) { openApp(this, if (noteId != null) "/quick/$noteId" else "/quick"); finish(); return }
                ask(if (kind == "text") "New note" else "Add to the list", if (kind == "text") "Type a note…" else "Item") { text ->
                    Thread { report(app, WidgetActions.run(app, kind, noteId, null, text)) }.start()
                }
            }
            else -> finish()
        }
    }

    private fun report(ctx: Context, outcome: WidgetActions.Outcome) {
        Widgets.refresh(ctx)
        when (outcome) {
            is WidgetActions.Outcome.Failed -> runOnMain(ctx) { Toast.makeText(ctx, outcome.message, Toast.LENGTH_LONG).show() }
            is WidgetActions.Outcome.NeedsUnlock -> openApp(ctx, "/quick/inbox")
            else -> Unit
        }
    }

    private fun runOnMain(ctx: Context, block: () -> Unit) = android.os.Handler(ctx.mainLooper).post(block)

    /** A small text box over the home screen */
    private fun ask(title: String, hint: String, onSave: (String) -> Unit) {
        val input = EditText(this).apply {
            this.hint = hint
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 6
        }
        val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20f, resources.displayMetrics).toInt()
        val box = FrameLayout(this).apply { setPadding(pad, pad / 2, pad, 0); addView(input) }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(title)
            .setView(box)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ -> input.text.toString().trim().takeIf { it.isNotBlank() }?.let(onSave) }
            .create()
        dialog.setOnDismissListener { finish() }
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        dialog.show()
        input.requestFocus()
    }
}
