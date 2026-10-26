package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import com.sanpan003.pocketarchive.R
import com.sanpan003.pocketarchive.widget.WidgetConfig
import com.sanpan003.pocketarchive.widget.WidgetModel
import com.sanpan003.pocketarchive.widget.WidgetSource
import com.sanpan003.pocketarchive.widget.Widgets
import org.json.JSONObject

/**
 * The Pocket Archive widget (resizable; each one has its own settings — long-press → Settings):
 * - 1x1: the Neon Bolt (tap = record, tap again = stop; red ring + time while recording)
 * - 2x1 / 3x1: Bolt + Scan + Camera + Type (✏️), and a status line on 3x1
 * - 4x2+: header with the status line ("Offline · 2 waiting to upload" / "Syncing…" / "Synced 5 min ago") and the
 *   buttons, filter chips, "Up next" (the next 3 reminders / events with a countdown), and a scrollable list of up to
 *   50 notes with inline actions (tick list items, Done, Snooze 1 h). Actions are hidden unless switched on.
 * App locked: no titles, and taps that would change something open the app to unlock.
 */
class QuickToggleWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        updateAll(ctx)
        WidgetRefreshWorker.schedulePeriodic(ctx)
        WidgetData.refreshAsync(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) = updateAll(ctx)

    override fun onEnabled(ctx: Context) {
        WidgetRefreshWorker.schedulePeriodic(ctx)
        WidgetData.refreshAsync(ctx)
    }

    override fun onDeleted(ctx: Context, ids: IntArray) { for (id in ids) WidgetConfig.delete(ctx, id) }

    override fun onDisabled(ctx: Context) = WidgetRefreshWorker.cancelPeriodic(ctx)

    /** Everything a layout needs, read once per redraw. */
    private class Snapshot(
        val recording: Boolean,
        val startedAt: Long,
        val phase: WidgetState.Phase,
        val phaseText: String,
        val resultNoteId: String?,
        val notes: List<JSONObject>,
        val locked: Boolean,
        val signedOut: Boolean,
        val status: String,
        val now: Long,
    ) {
        val busy get() = phase == WidgetState.Phase.UPLOADING || phase == WidgetState.Phase.PROCESSING
    }

    companion object {
        private const val MEDIUM_MIN_W = 130f
        private const val MEDIUM_TEXT_W = 230f   // the status line needs room next to Bolt + Scan + Camera + Type
        private const val LARGE_MIN_W = 250f
        private const val LARGE_MIN_H = 170f

        private val CHIP_IDS = intArrayOf(R.id.fd_chip0, R.id.fd_chip1, R.id.fd_chip2, R.id.fd_chip3, R.id.fd_chip4, R.id.fd_chip5, R.id.fd_chip6)
        private val UP_IDS = intArrayOf(R.id.fd_up1, R.id.fd_up2, R.id.fd_up3)

        private fun ids(ctx: Context): IntArray =
            AppWidgetManager.getInstance(ctx)?.getAppWidgetIds(ComponentName(ctx, QuickToggleWidget::class.java)) ?: IntArray(0)

        fun hasWidgets(ctx: Context) = ids(ctx).isNotEmpty()

        /** Redraw (off the main thread) */
        fun updateAll(ctx: Context) = Widgets.refresh(ctx)

        /** The actual drawing — Widgets.refresh calls this on its thread */
        fun render(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            val ids = ids(ctx)
            if (ids.isEmpty()) return
            val large = ids.any { isLarge(manager, it) } || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            val s = Snapshot(
                recording = RecorderState.recording,
                startedAt = RecorderState.startedAt,
                phase = WidgetState.current(),
                phaseText = WidgetState.text,
                resultNoteId = WidgetState.noteId,
                notes = if (large) WidgetSource.notes(ctx) else emptyList(),
                locked = AppLock.isLocked(ctx),
                signedOut = WidgetSource.signedOut(ctx),
                status = WidgetSource.status(ctx),
                now = System.currentTimeMillis(),
            )
            for (id in ids) {
                val cfg = WidgetConfig.load(ctx, id)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // One RemoteViews per size; the launcher switches between them while resizing
                    manager.updateAppWidget(id, RemoteViews(mapOf(
                        SizeF(40f, 40f) to small(ctx, s),
                        SizeF(MEDIUM_MIN_W, 40f) to medium(ctx, s, id, withText = false),
                        SizeF(MEDIUM_TEXT_W, 40f) to medium(ctx, s, id, withText = true),
                        SizeF(LARGE_MIN_W, LARGE_MIN_H) to feed(ctx, s, id, cfg),
                    )))
                } else {
                    val o = manager.getAppWidgetOptions(id)
                    val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 40).toFloat()
                    manager.updateAppWidget(id, when {
                        isLarge(manager, id) -> feed(ctx, s, id, cfg)
                        w >= MEDIUM_MIN_W -> medium(ctx, s, id, withText = w >= MEDIUM_TEXT_W)
                        else -> small(ctx, s)
                    })
                }
            }
        }

        private fun isLarge(manager: AppWidgetManager, id: Int): Boolean {
            val o = manager.getAppWidgetOptions(id)
            return o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 40) >= LARGE_MIN_W && o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 40) >= LARGE_MIN_H
        }

        // ── Intents ────────────────────────────────────────────────────────

        private fun toggleIntent(ctx: Context): PendingIntent = PendingIntent.getActivity(
            ctx, 1,
            Intent(ctx, RecordTrampolineActivity::class.java)
                .setAction(QuickActions.ACTION_TOGGLE_RECORDING)
                .putExtra(RecordTrampolineActivity.EXTRA_FROM, RecordingLog.WIDGET)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        /** Scan / Camera: a transparent activity opens the scanner or the camera (no app screens) */
        private fun captureIntent(ctx: Context, action: String, code: Int): PendingIntent = PendingIntent.getActivity(
            ctx, code,
            Intent(ctx, CaptureActivity::class.java).setAction(action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        fun scanIntent(ctx: Context) = captureIntent(ctx, CaptureActivity.ACTION_SCAN, 41)
        fun cameraIntent(ctx: Context) = captureIntent(ctx, CaptureActivity.ACTION_CAMERA, 42)
        private fun typeIntent(ctx: Context, id: Int) = Widgets.action(ctx, "text", id, 43)

        private fun inboxIntent(ctx: Context, noteId: String? = null): PendingIntent =
            Notifications.openApp(ctx, if (noteId == null) "/quick/inbox" else "/quick/inbox?note=${android.net.Uri.encode(noteId)}")

        private fun micDescription(s: Snapshot) = if (s.recording) "Stop recording" else "Start Quick Capture"

        private fun chronoBase(s: Snapshot) =
            SystemClock.elapsedRealtime() - (System.currentTimeMillis() - s.startedAt).coerceAtLeast(0)

        // ── 1x1 ────────────────────────────────────────────────────────────

        private fun small(ctx: Context, s: Snapshot) = RemoteViews(ctx.packageName, R.layout.widget_quick).apply {
            setImageViewResource(R.id.widget_bg, if (s.recording) R.drawable.widget_bg_rec_ring else R.drawable.widget_bg_bolt)
            setImageViewResource(R.id.widget_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_bolt_neon)
            setViewVisibility(R.id.widget_progress, if (s.busy && !s.recording) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.widget_chrono, if (s.recording) View.VISIBLE else View.GONE)
            setChronometer(R.id.widget_chrono, chronoBase(s), null, s.recording)
            setContentDescription(R.id.widget_root, micDescription(s))
            setOnClickPendingIntent(R.id.widget_root, toggleIntent(ctx))
        }

        // ── 2x1 / 3x1 ──────────────────────────────────────────────────────

        private fun medium(ctx: Context, s: Snapshot, id: Int, withText: Boolean) = RemoteViews(ctx.packageName, R.layout.widget_medium).apply {
            setOnClickPendingIntent(R.id.med_scan, scanIntent(ctx))
            setOnClickPendingIntent(R.id.med_camera, cameraIntent(ctx))
            setOnClickPendingIntent(R.id.med_type, typeIntent(ctx, id))
            val compactBusy = !withText && (s.recording || s.phase != WidgetState.Phase.IDLE)
            setViewVisibility(R.id.med_text, if (withText || compactBusy) View.VISIBLE else View.GONE)
            for (b in intArrayOf(R.id.med_scan, R.id.med_camera, R.id.med_type)) setViewVisibility(b, if (compactBusy) View.GONE else View.VISIBLE)
            setImageViewResource(R.id.med_mic_bg, if (s.recording) R.drawable.widget_bg_rec_ring else R.drawable.widget_bg_bolt)
            setImageViewResource(R.id.med_mic_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_bolt_neon)
            setContentDescription(R.id.med_mic, micDescription(s))
            setOnClickPendingIntent(R.id.widget_root, toggleIntent(ctx))
            setOnClickPendingIntent(R.id.med_mic, toggleIntent(ctx))

            val showBusy = !s.recording && s.phase != WidgetState.Phase.IDLE
            setViewVisibility(R.id.med_rec_row, if (s.recording) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.med_busy_row, if (showBusy) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.med_status, if (!s.recording && !showBusy) View.VISIBLE else View.GONE)
            setChronometer(R.id.med_chrono, chronoBase(s), null, s.recording)
            when {
                s.recording -> setOnClickPendingIntent(R.id.med_text, toggleIntent(ctx))
                showBusy -> {
                    setViewVisibility(R.id.med_spinner, if (s.busy) View.VISIBLE else View.GONE)
                    setTextViewText(R.id.med_busy_text, s.phaseText)
                    setOnClickPendingIntent(R.id.med_text, inboxIntent(ctx, s.resultNoteId))
                }
                else -> {
                    setTextViewText(R.id.med_status, s.status)
                    setOnClickPendingIntent(R.id.med_text, inboxIntent(ctx))
                }
            }
        }

        // ── 4x2 and larger ─────────────────────────────────────────────────

        private fun feed(ctx: Context, s: Snapshot, id: Int, cfg: WidgetConfig) = RemoteViews(ctx.packageName, R.layout.widget_feed).apply {
            val p = Widgets.palette(ctx, cfg)
            Widgets.background(this, R.id.fd_bg, p, cfg.opacity)
            setTextColor(R.id.fd_status, p.sub)
            setTextColor(R.id.fd_empty, p.sub)
            setTextColor(R.id.fd_busy_text, p.text)
            setTextColor(R.id.fd_rec_hint, p.sub)
            for (up in UP_IDS) setTextColor(up, p.text)
            setTextViewText(R.id.fd_status, s.status)
            setOnClickPendingIntent(R.id.fd_header, inboxIntent(ctx))

            // Buttons
            setImageViewResource(R.id.fd_bolt_bg, if (s.recording) R.drawable.widget_bg_rec_ring else R.drawable.widget_bg_bolt)
            setImageViewResource(R.id.fd_bolt_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_bolt_neon)
            setContentDescription(R.id.fd_bolt, micDescription(s))
            setOnClickPendingIntent(R.id.fd_bolt, toggleIntent(ctx))
            setOnClickPendingIntent(R.id.fd_scan, scanIntent(ctx))
            setOnClickPendingIntent(R.id.fd_camera, cameraIntent(ctx))
            setOnClickPendingIntent(R.id.fd_type, typeIntent(ctx, id))

            // Filter chips (tap = filter in place)
            val chips = cfg.shownChips
            CHIP_IDS.forEachIndexed { i, chipId ->
                val f = chips.getOrNull(i)
                if (f == null || s.locked || s.signedOut) { setViewVisibility(chipId, View.GONE); return@forEachIndexed }
                val on = f == cfg.filter
                setViewVisibility(chipId, View.VISIBLE)
                setTextViewText(chipId, WidgetModel.FILTER_LABEL[f])
                setTextColor(chipId, if (on) p.chipOnText else p.chipText)
                setInt(chipId, "setBackgroundResource", if (on) R.drawable.widget_chip_on else R.drawable.widget_chip_off)
                setContentDescription(chipId, "Show ${WidgetModel.FILTER_LABEL[f]}${if (on) ", selected" else ""}")
                setOnClickPendingIntent(chipId, Widgets.action(ctx, "chip", id, 10 + i, filter = f))
            }

            val showBusy = !s.recording && s.phase != WidgetState.Phase.IDLE
            val showList = !s.recording && !showBusy

            // Up next
            val next = if (cfg.upNext && showList && !s.locked) WidgetModel.upNext(s.notes, s.now) else emptyList()
            setViewVisibility(R.id.fd_upnext, if (next.isNotEmpty()) View.VISIBLE else View.GONE)
            UP_IDS.forEachIndexed { i, upId ->
                val it = next.getOrNull(i)
                if (it == null) { setViewVisibility(upId, View.GONE); return@forEachIndexed }
                setViewVisibility(upId, View.VISIBLE)
                setTextViewText(upId, "${it.icon} ${WidgetModel.upNextLine(it, s.now, cfg.hideTitles)}")
                setOnClickPendingIntent(upId, Widgets.action(ctx, "open", id, 20 + i, noteId = it.id))
            }

            // Recording / uploading / result
            setViewVisibility(R.id.fd_rec, if (s.recording) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.fd_busy, if (showBusy) View.VISIBLE else View.GONE)
            setChronometer(R.id.fd_chrono, chronoBase(s), null, s.recording)
            setOnClickPendingIntent(R.id.fd_stop, toggleIntent(ctx))
            setOnClickPendingIntent(R.id.fd_rec, toggleIntent(ctx))
            setViewVisibility(R.id.fd_spinner, if (s.busy) View.VISIBLE else View.GONE)
            setTextViewText(R.id.fd_busy_text, s.phaseText)
            setOnClickPendingIntent(R.id.fd_busy, inboxIntent(ctx, s.resultNoteId))
            val capture = WidgetState.captureId
            val withActions = s.phase == WidgetState.Phase.RESULT && capture != null
            setViewVisibility(R.id.fd_actions, if (withActions) View.VISIBLE else View.GONE)
            if (capture != null && withActions) {
                if (WidgetState.ask) {
                    setTextViewText(R.id.fd_action1, "Yes"); setTextViewText(R.id.fd_action2, "New note")
                    setOnClickPendingIntent(R.id.fd_action1, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_YES, capture))
                    setOnClickPendingIntent(R.id.fd_action2, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_NEW, capture))
                } else {
                    setTextViewText(R.id.fd_action1, "Undo"); setTextViewText(R.id.fd_action2, "Move")
                    setOnClickPendingIntent(R.id.fd_action1, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_UNDO, capture))
                    setOnClickPendingIntent(R.id.fd_action2, Notifications.openApp(ctx, "/quick/inbox?move=$capture"))
                }
            }

            // The list (scrollable, up to 50)
            val items = if (s.locked) emptyList() else WidgetModel.items(s.notes, cfg.filter, cfg.showActions, cfg.sort)
            setViewVisibility(R.id.fd_list_area, if (showList) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.fd_list, if (items.isNotEmpty()) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.fd_empty, if (items.isEmpty()) View.VISIBLE else View.GONE)
            setTextViewText(R.id.fd_empty, when {
                s.signedOut -> "Open Pocket Archive to sign in"
                s.locked -> "🔒 Unlock Pocket Archive to see your notes"
                cfg.filter != "all" -> "Nothing here — tap All"
                else -> "No notes yet — tap the bolt"
            })
            setOnClickPendingIntent(R.id.fd_empty, inboxIntent(ctx))
            setPendingIntentTemplate(R.id.fd_list, Widgets.listTemplate(ctx, id, 50))
            Widgets.setList(ctx, this, id, R.id.fd_list, items.map { Widgets.stableId(it.id) to Widgets.feedRow(ctx, it, cfg, p, s.now) })
        }
    }
}
