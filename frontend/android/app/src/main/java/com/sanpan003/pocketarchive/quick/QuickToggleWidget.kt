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

/**
 * Resizable Quick Capture widget. Layout depends on its size:
 * - 1x1: gold mic (tap = start, tap again = stop + upload; doesn't open the app)
 * - 2x1: mic + Scan + Camera; 3x1: plus one status line ("Last: Dentist · 2h ago" / "● 0:12 Tap to stop")
 * - 4x2+: header, the 5 most recent quick notes, a big Stop button while
 *   recording, and "Uploading… → Processing… → result" after stopping.
 */
class QuickToggleWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        updateAll(ctx)
        WidgetRefreshWorker.schedulePeriodic(ctx)
        WidgetData.refreshAsync(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        updateAll(ctx)
    }

    override fun onEnabled(ctx: Context) {
        WidgetRefreshWorker.schedulePeriodic(ctx)
        WidgetData.refreshAsync(ctx)
    }

    override fun onDisabled(ctx: Context) = WidgetRefreshWorker.cancelPeriodic(ctx)

    /** Everything a layout needs, read once per redraw. */
    private class Snapshot(
        val recording: Boolean,
        val startedAt: Long,
        val phase: WidgetState.Phase,
        val phaseText: String,
        val resultNoteId: String?,
        val items: List<WidgetData.Item>,
        val pending: Int,
        val offline: Boolean,
        val signedOut: Boolean,
    ) {
        val busy get() = phase == WidgetState.Phase.UPLOADING || phase == WidgetState.Phase.PROCESSING
    }

    companion object {
        // Size buckets (dp). Android picks the largest one that fits the widget.
        private const val MEDIUM_MIN_W = 130f
        private const val MEDIUM_TEXT_W = 200f   // the status line needs room next to mic + Scan + Camera
        private const val LARGE_MIN_W = 250f
        private const val LARGE_MIN_H = 170f
        private const val ROW_H = 30f
        private const val ROWS = 5

        private val ROW_IDS = arrayOf(
            intArrayOf(R.id.lg_row1, R.id.lg_row1_icon, R.id.lg_row1_title, R.id.lg_row1_dot, R.id.lg_row1_time),
            intArrayOf(R.id.lg_row2, R.id.lg_row2_icon, R.id.lg_row2_title, R.id.lg_row2_dot, R.id.lg_row2_time),
            intArrayOf(R.id.lg_row3, R.id.lg_row3_icon, R.id.lg_row3_title, R.id.lg_row3_dot, R.id.lg_row3_time),
            intArrayOf(R.id.lg_row4, R.id.lg_row4_icon, R.id.lg_row4_title, R.id.lg_row4_dot, R.id.lg_row4_time),
            intArrayOf(R.id.lg_row5, R.id.lg_row5_icon, R.id.lg_row5_title, R.id.lg_row5_dot, R.id.lg_row5_time),
        )

        private fun ids(ctx: Context): IntArray {
            val manager = AppWidgetManager.getInstance(ctx) ?: return IntArray(0)
            return manager.getAppWidgetIds(ComponentName(ctx, QuickToggleWidget::class.java))
        }

        fun hasWidgets(ctx: Context) = ids(ctx).isNotEmpty()

        fun updateAll(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            val ids = ids(ctx)
            if (ids.isEmpty()) return

            val s = Snapshot(
                recording = RecorderState.recording,
                startedAt = RecorderState.startedAt,
                phase = WidgetState.current(),
                phaseText = WidgetState.text,
                resultNoteId = WidgetState.noteId,
                items = WidgetData.items(ctx),
                pending = PendingStore.count(ctx) + DocQueue.count(ctx),
                offline = WidgetData.offline(ctx),
                signedOut = WidgetData.signedOut(ctx),
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // One RemoteViews per size; the launcher switches between them while resizing
                val views = RemoteViews(mapOf(
                    SizeF(40f, 40f) to small(ctx, s),
                    SizeF(MEDIUM_MIN_W, 40f) to medium(ctx, s, withText = false),
                    SizeF(MEDIUM_TEXT_W, 40f) to medium(ctx, s, withText = true),
                    SizeF(LARGE_MIN_W, LARGE_MIN_H) to large(ctx, s, 3),
                    SizeF(LARGE_MIN_W, LARGE_MIN_H + ROW_H) to large(ctx, s, 4),
                    SizeF(LARGE_MIN_W, LARGE_MIN_H + 2 * ROW_H) to large(ctx, s, 5),
                ))
                manager.updateAppWidget(ids, views)
            } else {
                for (id in ids) {
                    val options = manager.getAppWidgetOptions(id)
                    val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 40).toFloat()
                    val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 40).toFloat()
                    val views = when {
                        w >= LARGE_MIN_W && h >= LARGE_MIN_H ->
                            large(ctx, s, (3 + ((h - LARGE_MIN_H) / ROW_H).toInt()).coerceIn(3, ROWS))
                        w >= MEDIUM_MIN_W -> medium(ctx, s, withText = w >= MEDIUM_TEXT_W)
                        else -> small(ctx, s)
                    }
                    manager.updateAppWidget(id, views)
                }
            }
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

        private fun inboxIntent(ctx: Context, noteId: String? = null): PendingIntent =
            Notifications.openApp(ctx, if (noteId == null) "/quick/inbox" else "/quick/inbox?note=${android.net.Uri.encode(noteId)}")

        private fun micDescription(s: Snapshot) = if (s.recording) "Stop recording" else "Start Quick Capture"

        private fun chronoBase(s: Snapshot) =
            SystemClock.elapsedRealtime() - (System.currentTimeMillis() - s.startedAt).coerceAtLeast(0)

        // ── 1x1 ────────────────────────────────────────────────────────────

        private fun small(ctx: Context, s: Snapshot) = RemoteViews(ctx.packageName, R.layout.widget_quick).apply {
            setImageViewResource(R.id.widget_bg, if (s.recording) R.drawable.widget_bg_recording else R.drawable.widget_bg_idle)
            setImageViewResource(R.id.widget_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_mic_white)
            setViewVisibility(R.id.widget_progress, if (s.busy && !s.recording) View.VISIBLE else View.GONE)
            setContentDescription(R.id.widget_root, micDescription(s))
            setOnClickPendingIntent(R.id.widget_root, toggleIntent(ctx))
        }

        // ── 2x1 / 3x1 ──────────────────────────────────────────────────────

        private fun medium(ctx: Context, s: Snapshot, withText: Boolean) = RemoteViews(ctx.packageName, R.layout.widget_medium).apply {
            setOnClickPendingIntent(R.id.med_scan, scanIntent(ctx))
            setOnClickPendingIntent(R.id.med_camera, cameraIntent(ctx))
            // 2x1: mic + the two buttons; while recording / uploading / showing a result the line takes their place.
            // 3x1 and wider: everything.
            val compactBusy = !withText && (s.recording || s.phase != WidgetState.Phase.IDLE)
            setViewVisibility(R.id.med_text, if (withText || compactBusy) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.med_scan, if (compactBusy) View.GONE else View.VISIBLE)
            setViewVisibility(R.id.med_camera, if (compactBusy) View.GONE else View.VISIBLE)
            setImageViewResource(R.id.med_mic_bg, if (s.recording) R.drawable.widget_bg_recording else R.drawable.widget_bg_idle)
            setImageViewResource(R.id.med_mic_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_mic_white)
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
                    val last = s.items.firstOrNull()
                    val status = when {
                        s.signedOut -> "Open the app to sign in"
                        s.pending > 0 -> "${s.pending} waiting to upload"
                        last != null -> "Last: ${last.title} · ${WidgetData.relativeTime(last.createdAt)}"
                        else -> "Tap the mic to record"
                    }
                    setTextViewText(R.id.med_status, status)
                    setOnClickPendingIntent(R.id.med_text, inboxIntent(ctx, last?.id))
                }
            }
        }

        // ── 4x2 and larger ─────────────────────────────────────────────────

        private fun large(ctx: Context, s: Snapshot, rows: Int) = RemoteViews(ctx.packageName, R.layout.widget_large).apply {
            setImageViewResource(R.id.lg_mic_bg, if (s.recording) R.drawable.widget_bg_recording else R.drawable.widget_bg_idle)
            setImageViewResource(R.id.lg_mic_icon, if (s.recording) R.drawable.ic_stop_white else R.drawable.ic_mic_white)
            setContentDescription(R.id.lg_mic, micDescription(s))
            setOnClickPendingIntent(R.id.lg_mic, toggleIntent(ctx))
            setOnClickPendingIntent(R.id.lg_scan, scanIntent(ctx))
            setOnClickPendingIntent(R.id.lg_camera, cameraIntent(ctx))
            setOnClickPendingIntent(R.id.lg_header, inboxIntent(ctx))

            // Header extras: offline / signed-out hint, queued uploads badge
            val subtitle = when {
                s.signedOut -> "Signed out — open the app"
                s.offline -> "Offline · showing saved list"
                else -> null
            }
            setViewVisibility(R.id.lg_subtitle, if (subtitle != null) View.VISIBLE else View.GONE)
            setTextViewText(R.id.lg_subtitle, subtitle ?: "")
            setViewVisibility(R.id.lg_pending, if (s.pending > 0) View.VISIBLE else View.GONE)
            setTextViewText(R.id.lg_pending, "⇡ ${s.pending} pending")
            setContentDescription(R.id.lg_pending, "${s.pending} notes waiting to upload")

            val showBusy = !s.recording && s.phase != WidgetState.Phase.IDLE
            val showList = !s.recording && !showBusy
            setViewVisibility(R.id.lg_rec, if (s.recording) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.lg_busy, if (showBusy) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.lg_list, if (showList && s.items.isNotEmpty()) View.VISIBLE else View.GONE)
            setViewVisibility(R.id.lg_empty, if (showList && s.items.isEmpty()) View.VISIBLE else View.GONE)

            // Recording
            setChronometer(R.id.lg_chrono, chronoBase(s), null, s.recording)
            setOnClickPendingIntent(R.id.lg_stop, toggleIntent(ctx))

            // Uploading / Processing / result
            setViewVisibility(R.id.lg_spinner, if (s.busy) View.VISIBLE else View.GONE)
            setTextViewText(R.id.lg_busy_text, s.phaseText)
            setOnClickPendingIntent(R.id.lg_busy, inboxIntent(ctx, s.resultNoteId))
            // Smart append: Undo / Move, or Yes / New note for "Add to …?"
            val capture = WidgetState.captureId
            val withActions = s.phase == WidgetState.Phase.RESULT && capture != null
            setViewVisibility(R.id.lg_actions, if (withActions) View.VISIBLE else View.GONE)
            if (capture != null && withActions) {
                if (WidgetState.ask) {
                    setTextViewText(R.id.lg_action1, "Yes")
                    setTextViewText(R.id.lg_action2, "New note")
                    setOnClickPendingIntent(R.id.lg_action1, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_YES, capture))
                    setOnClickPendingIntent(R.id.lg_action2, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_NEW, capture))
                } else {
                    setTextViewText(R.id.lg_action1, "Undo")
                    setTextViewText(R.id.lg_action2, "Move")
                    setOnClickPendingIntent(R.id.lg_action1, QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_UNDO, capture))
                    setOnClickPendingIntent(R.id.lg_action2, Notifications.openApp(ctx, "/quick/inbox?move=$capture"))
                }
            }

            // Recent notes
            setTextViewText(R.id.lg_empty, if (s.signedOut) "Open Pocket Archive to sign in" else "No quick notes yet — tap the mic")
            setOnClickPendingIntent(R.id.lg_empty, inboxIntent(ctx))
            val now = System.currentTimeMillis()
            ROW_IDS.forEachIndexed { i, (row, icon, title, dot, time) ->
                val item = s.items.getOrNull(i)
                if (item == null || i >= rows) {
                    setViewVisibility(row, View.GONE)
                    return@forEachIndexed
                }
                setViewVisibility(row, View.VISIBLE)
                setTextViewText(icon, WidgetData.typeIcon(item.type, item.icon))
                setTextViewText(title, item.title)
                setViewVisibility(dot, if (item.needsReview) View.VISIBLE else View.GONE)
                val ago = WidgetData.relativeTime(item.createdAt, now)
                setTextViewText(time, item.progress?.let { "$it · $ago" } ?: ago)
                setContentDescription(row, "${item.title}, ${WidgetData.relativeTime(item.createdAt, now)}${if (item.needsReview) ", needs review" else ""}")
                setOnClickPendingIntent(row, inboxIntent(ctx, item.id))
            }
        }
    }
}
