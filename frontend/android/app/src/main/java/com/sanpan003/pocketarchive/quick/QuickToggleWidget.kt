package com.sanpan003.pocketarchive.quick

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.sanpan003.pocketarchive.R

/** 1x1 gold mic: tap to start recording, tap again to stop + upload. Doesn't open the app. */
class QuickToggleWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) = updateAll(ctx)

    companion object {
        fun updateAll(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            val ids = manager.getAppWidgetIds(ComponentName(ctx, QuickToggleWidget::class.java))
            if (ids.isEmpty()) return

            val recording = RecorderState.recording
            val toggle = PendingIntent.getActivity(
                ctx, 1,
                Intent(ctx, RecordTrampolineActivity::class.java)
                    .setAction(QuickActions.ACTION_TOGGLE_RECORDING)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val views = RemoteViews(ctx.packageName, R.layout.widget_quick).apply {
                setImageViewResource(R.id.widget_bg, if (recording) R.drawable.widget_bg_recording else R.drawable.widget_bg_idle)
                setImageViewResource(R.id.widget_icon, if (recording) R.drawable.ic_stop_white else R.drawable.ic_mic_white)
                setContentDescription(R.id.widget_root, if (recording) "Stop recording" else "Start Quick Capture")
                setOnClickPendingIntent(R.id.widget_root, toggle)
            }
            manager.updateAppWidget(ids, views)
        }
    }
}
