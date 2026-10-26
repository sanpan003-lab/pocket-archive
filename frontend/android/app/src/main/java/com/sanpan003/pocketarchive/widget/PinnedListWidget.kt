package com.sanpan003.pocketarchive.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.sanpan003.pocketarchive.R
import com.sanpan003.pocketarchive.quick.AppLock
import com.sanpan003.pocketarchive.quick.Notifications

/**
 * "Pocket Archive · List" (2.10.0): one list or errand (chosen on its settings screen, e.g. Publix) with its checklist —
 * tick items off and "+ Add item" right on the home screen. Works offline (the offline copy + queue). While the app is
 * locked: no item names, and taps open the app to unlock.
 */
class PinnedListWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refresh(ctx)
    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) = Widgets.refresh(ctx)
    override fun onDeleted(ctx: Context, ids: IntArray) { for (id in ids) WidgetConfig.delete(ctx, id) }

    companion object {
        fun render(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            val ids = Widgets.ids(ctx, PinnedListWidget::class.java)
            if (ids.isEmpty()) return
            val locked = AppLock.isLocked(ctx)
            val notes = WidgetSource.notes(ctx)
            val status = WidgetSource.status(ctx)
            for (id in ids) manager.updateAppWidget(id, view(ctx, id, WidgetConfig.load(ctx, id), notes, locked, status))
        }

        private fun view(ctx: Context, id: Int, cfg: WidgetConfig, notes: List<org.json.JSONObject>, locked: Boolean, status: String) =
            RemoteViews(ctx.packageName, R.layout.widget_list).apply {
                val p = Widgets.palette(ctx, cfg)
                Widgets.background(this, R.id.ls_bg, p, cfg.opacity)
                setTextColor(R.id.ls_status, p.sub)
                setTextColor(R.id.ls_empty, p.sub)
                setTextViewText(R.id.ls_status, status)
                val note = cfg.listId?.let { lid -> notes.firstOrNull { it.optString("id") == lid } }
                val item = note?.let { WidgetModel.itemOf(it) }
                val hide = cfg.hideTitles || locked
                setTextViewText(R.id.ls_title, when {
                    locked -> "🔒 List"
                    item == null -> "Pocket Archive · List"
                    hide -> "List"
                    else -> "${item.icon} ${item.title}"
                })
                setOnClickPendingIntent(R.id.ls_header, if (item != null) Widgets.action(ctx, "open", id, 30, noteId = item.id) else Notifications.openApp(ctx, "/lists"))
                setViewVisibility(R.id.ls_add, if (item != null) View.VISIBLE else View.GONE)
                if (item != null) setOnClickPendingIntent(R.id.ls_add, Widgets.action(ctx, "addItem", id, 31, noteId = item.id))
                // Open items first, then the checked ones
                val rows = if (item == null || locked) emptyList() else item.items.sortedBy { it.done }
                setViewVisibility(R.id.ls_list, if (rows.isNotEmpty()) View.VISIBLE else View.GONE)
                setViewVisibility(R.id.ls_empty, if (rows.isEmpty()) View.VISIBLE else View.GONE)
                setTextViewText(R.id.ls_empty, when {
                    locked -> "🔒 Unlock Pocket Archive to see this list"
                    cfg.listId == null -> "Long-press → Settings to choose a list"
                    item == null -> "This list isn’t on this phone — open the app, or choose another"
                    else -> "Nothing on the list — tap + Add item"
                })
                setPendingIntentTemplate(R.id.ls_list, Widgets.listTemplate(ctx, id, 51))
                Widgets.setList(ctx, this, id, R.id.ls_list, rows.map { li -> Widgets.stableId(li.id) to Widgets.listRow(ctx, item!!.id, li, p, hide) })
            }
    }
}
