package com.sanpan003.pocketarchive.quick

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.RemoteViews
import com.sanpan003.pocketarchive.R

/** Optional 1x1 "Quick Scan" widget: one tap → the document scanner → a new note (no app screens) */
class QuickScanWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        val views = RemoteViews(ctx.packageName, R.layout.widget_scan).apply {
            setOnClickPendingIntent(R.id.scan_root, QuickToggleWidget.scanIntent(ctx))
        }
        manager.updateAppWidget(ids, views)
    }
}

/** Optional Quick Settings tile "Quick Scan". On the lock screen Android asks to unlock first. */
class QuickScanTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            label = getString(R.string.tile_scan_label)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) subtitle = "Scan a document"
            updateTile()
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        val open = {
            val intent = Intent(this, CaptureActivity::class.java).setAction(CaptureActivity.ACTION_SCAN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 43, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
        }
        if (isLocked) unlockAndRun { open() } else open()
    }
}
