package com.sanpan003.pocketarchive.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat
import com.sanpan003.pocketarchive.R
import com.sanpan003.pocketarchive.quick.QuickToggleWidget
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Shared by the two widgets (2.10.0): colors per widget (theme + transparency), the scrollable list (RemoteCollectionItems
 * — works on One UI and Pixel launchers), rows with inline actions, and redrawing everything off the main thread.
 */
object Widgets {
    private val io = Executors.newSingleThreadExecutor()

    /** Redraw every widget (both kinds), off the main thread */
    fun refresh(ctx: Context) {
        val app = ctx.applicationContext
        io.execute { runCatching { QuickToggleWidget.render(app); PinnedListWidget.render(app) } }
    }

    fun ids(ctx: Context, cls: Class<*>): IntArray =
        AppWidgetManager.getInstance(ctx)?.getAppWidgetIds(ComponentName(ctx, cls)) ?: IntArray(0)

    // ── Colors ───────────────────────────────────────────────────────────────
    data class Palette(val bg: Int, val text: Int, val sub: Int, val chipText: Int, val chipOnText: Int, val dark: Boolean)

    fun palette(ctx: Context, cfg: WidgetConfig): Palette {
        val dark = when (cfg.theme) {
            "dark" -> true
            "light" -> false
            else -> (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        }
        return if (dark) Palette(Color.parseColor("#0B0B10"), Color.WHITE, Color.parseColor("#A0A8B8"), Color.parseColor("#CBD5E1"), Color.parseColor("#FCD34D"), true)
        else Palette(Color.WHITE, Color.parseColor("#0F172A"), Color.parseColor("#64748B"), Color.parseColor("#334155"), Color.parseColor("#B45309"), false)
    }

    /** The background image: tinted to the theme, as transparent as chosen */
    fun background(rv: RemoteViews, id: Int, p: Palette, opacity: Int) {
        rv.setInt(id, "setColorFilter", p.bg)
        rv.setInt(id, "setImageAlpha", (opacity.coerceIn(0, 100) * 255) / 100)
    }

    // ── Intents ──────────────────────────────────────────────────────────────
    /** The template for every tap inside a list (rows fill in what was tapped) */
    fun listTemplate(ctx: Context, widgetId: Int, code: Int): PendingIntent = PendingIntent.getActivity(
        ctx, widgetId * 100 + code,
        Intent(ctx, WidgetActionActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun action(ctx: Context, kind: String, widgetId: Int, code: Int, noteId: String? = null, filter: String? = null): PendingIntent =
        PendingIntent.getActivity(ctx, widgetId * 100 + code, WidgetActionActivity.intent(ctx, kind, widgetId, noteId, filter),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun fill(kind: String, noteId: String, itemId: String? = null) =
        Intent().putExtra(WidgetActionActivity.EXTRA_KIND, kind).putExtra(WidgetActionActivity.EXTRA_NOTE, noteId)
            .apply { if (itemId != null) putExtra(WidgetActionActivity.EXTRA_ITEM, itemId) }

    // ── Rows ────────────────────────────────────────────────────────────────
    private val CHECK_ROWS = arrayOf(
        intArrayOf(R.id.row_check0, R.id.row_check0_box, R.id.row_check0_text),
        intArrayOf(R.id.row_check1, R.id.row_check1_box, R.id.row_check1_text),
        intArrayOf(R.id.row_check2, R.id.row_check2_box, R.id.row_check2_text),
    )

    /** One note in the main widget's list */
    fun feedRow(ctx: Context, it: WidgetModel.Item, cfg: WidgetConfig, p: Palette, now: Long): RemoteViews =
        RemoteViews(ctx.packageName, R.layout.widget_feed_row).apply {
            val compact = cfg.density == "compact"
            val pad = if (compact) 3 else 7
            val px = (pad * ctx.resources.displayMetrics.density).toInt()
            setViewPadding(R.id.row, 0, px, 0, px)
            setTextViewText(R.id.row_icon, it.icon)
            setTextViewText(R.id.row_title, if (cfg.hideTitles) WidgetModel.privateTitle(it) else it.title)
            setTextColor(R.id.row_title, p.text)
            setTextColor(R.id.row_sub, p.sub)
            val parts = mutableListOf<String>()
            if (it.needsReview) parts += "Needs review"
            it.progress?.let { pr -> parts += pr }
            if (cfg.showTimes) {
                if (it.due != null) parts += WidgetModel.timeLabel(it.due, it.allDay, now)
                else it.createdAt?.let { c -> runCatching { java.time.Instant.parse(c).toEpochMilli() }.getOrNull()?.let { ms -> parts += com.sanpan003.pocketarchive.quick.WidgetData.relativeTime(ms, now) } }
            }
            if (it.shared) parts += "Shared"
            setTextViewText(R.id.row_sub, parts.joinToString(" · "))
            setViewVisibility(R.id.row_sub, if (parts.isEmpty() || compact) View.GONE else View.VISIBLE)
            setOnClickFillInIntent(R.id.row, fill("open", it.id))
            setViewVisibility(R.id.row_done, if (it.canDone) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.row_snooze, if (it.canSnooze) View.VISIBLE else View.GONE)
            if (it.canDone) setOnClickFillInIntent(R.id.row_done, fill("done", it.id))
            if (it.canSnooze) setOnClickFillInIntent(R.id.row_snooze, fill("snooze", it.id))
            setContentDescription(R.id.row_done, "Mark ${it.title} done")
            setContentDescription(R.id.row_snooze, "Snooze ${it.title} one hour")
            // Lists: tick off the first unchecked items right here
            val open = if (it.isList && !compact && !cfg.hideTitles) it.items.filter { li -> !li.done }.take(3) else emptyList()
            CHECK_ROWS.forEachIndexed { i, (row, box, text) ->
                val li = open.getOrNull(i)
                if (li == null) { setViewVisibility(row, View.GONE); return@forEachIndexed }
                setViewVisibility(row, View.VISIBLE)
                setImageViewResource(box, R.drawable.ic_check_off)
                setTextViewText(text, li.text)
                setTextColor(text, p.text)
                setContentDescription(row, "Check off ${li.text}")
                setOnClickFillInIntent(row, fill("toggle", it.id, li.id))
            }
        }

    /** One item of the pinned list */
    fun listRow(ctx: Context, noteId: String, li: WidgetModel.ListItem, p: Palette, hideTitles: Boolean): RemoteViews =
        RemoteViews(ctx.packageName, R.layout.widget_list_row).apply {
            setImageViewResource(R.id.lr_box, if (li.done) R.drawable.ic_check_on else R.drawable.ic_check_off)
            setTextViewText(R.id.lr_text, if (hideTitles) "Item" else li.text)
            setTextColor(R.id.lr_text, if (li.done) p.sub else p.text)
            setInt(R.id.lr_text, "setPaintFlags", if (li.done) android.graphics.Paint.STRIKE_THRU_TEXT_FLAG or android.graphics.Paint.ANTI_ALIAS_FLAG else android.graphics.Paint.ANTI_ALIAS_FLAG)
            setContentDescription(R.id.lr_row, "${li.text}, ${if (li.done) "checked" else "not checked"}")
            setOnClickFillInIntent(R.id.lr_row, fill("toggle", noteId, li.id))
        }

    /** Put rows into a ListView (scrollable, any launcher) */
    fun setList(ctx: Context, rv: RemoteViews, widgetId: Int, listId: Int, rows: List<Pair<Long, RemoteViews>>) {
        val b = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
        for ((id, row) in rows) b.addItem(id, row)
        RemoteViewsCompat.setRemoteAdapter(ctx, rv, widgetId, listId, b.build())
    }

    fun stableId(s: String): Long = s.hashCode().toLong() and 0xffffffffL

    /** A redraw after notes changed: the notes to draw from (empty while locked) */
    fun notes(ctx: Context): List<JSONObject> = WidgetSource.notes(ctx)
}
