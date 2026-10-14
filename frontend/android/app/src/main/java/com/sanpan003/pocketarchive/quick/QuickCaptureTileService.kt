package com.sanpan003.pocketarchive.quick

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile "Quick Capture" — same toggle as the widget, works from the lock screen. */
class QuickCaptureTileService : TileService() {

    companion object {
        fun refresh(ctx: Context) {
            runCatching {
                requestListeningState(ctx, ComponentName(ctx, QuickCaptureTileService::class.java))
            }
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        val intent = Intent(this, RecordTrampolineActivity::class.java)
            .setAction(QuickActions.ACTION_TOGGLE_RECORDING)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 2, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun updateTile() {
        val tile = qsTile ?: return
        val recording = RecorderState.recording
        tile.state = if (recording) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Quick Capture"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (recording) "Recording… tap to stop" else "Tap to record"
        }
        tile.updateTile()
    }
}
