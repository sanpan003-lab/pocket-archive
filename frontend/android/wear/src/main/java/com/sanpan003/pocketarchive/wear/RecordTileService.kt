package com.sanpan003.pocketarchive.wear

import android.content.Context
import androidx.concurrent.futures.SuspendToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.DimensionBuilders.wrap
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

/**
 * Tile: big gold mic (starts recording), the last note's title + time, and
 * "🛒 N open errands" when there are any.
 */
class RecordTileService : TileService() {

    companion object {
        private const val RES_VERSION = "1"
        private const val IMG_MIC = "mic"
        private const val IMG_STOP = "stop"

        fun requestUpdate(ctx: Context) {
            runCatching { getUpdater(ctx).requestUpdate(RecordTileService::class.java) }
        }
    }

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        SuspendToFutureAdapter.launchFuture {
            WatchData.load(applicationContext)
            TileBuilders.Tile.Builder()
                .setResourcesVersion(RES_VERSION)
                .setFreshnessIntervalMillis(30 * 60_000L)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout()))
                .build()
        }

    @Deprecated("Tiles keep calling this for resources of the layout above")
    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        SuspendToFutureAdapter.launchFuture {
            ResourceBuilders.Resources.Builder()
                .setVersion(RES_VERSION)
                .addIdToImageMapping(IMG_MIC, image(R.drawable.ic_mic_white))
                .addIdToImageMapping(IMG_STOP, image(R.drawable.ic_stop_white))
                .build()
        }

    private fun image(resId: Int) = ResourceBuilders.ImageResource.Builder()
        .setAndroidResourceByResId(ResourceBuilders.AndroidImageResourceByResId.Builder().setResourceId(resId).build())
        .build()

    private fun text(value: String, color: Int, size: Float, bold: Boolean = false) =
        LayoutElementBuilders.Text.Builder()
            .setText(value)
            .setMaxLines(1)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setColor(argb(color))
                    .setSize(sp(size))
                    .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                    .build(),
            )
            .build()

    private fun spacer(h: Float) = LayoutElementBuilders.Spacer.Builder().setHeight(dp(h)).build()

    private fun layout(): LayoutElementBuilders.LayoutElement {
        val snap = WatchData.snapshot.value
        val recording = WatchState.isRecording
        val last = snap.recent.firstOrNull()
        val openErrands = snap.errands.size

        val launch = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(MainActivity::class.java.name)
                    .addKeyToExtraMapping(MainActivity.EXTRA_RECORD, ActionBuilders.booleanExtra(true))
                    .build(),
            )
            .build()

        val micButton = LayoutElementBuilders.Box.Builder()
            .setWidth(dp(76f))
            .setHeight(dp(76f))
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(if (recording) 0xFFDC2626.toInt() else 0xFFF59E0B.toInt()))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(38f)).build())
                            .build(),
                    )
                    .setClickable(ModifiersBuilders.Clickable.Builder().setId("record").setOnClick(launch).build())
                    .setSemantics(ModifiersBuilders.Semantics.Builder().setContentDescription(if (recording) "Stop recording" else "Record a voice note").build())
                    .build(),
            )
            .addContent(
                LayoutElementBuilders.Image.Builder()
                    .setResourceId(if (recording) IMG_STOP else IMG_MIC)
                    .setWidth(dp(38f))
                    .setHeight(dp(38f))
                    .build(),
            )
            .build()

        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(wrap())
            .setHeight(wrap())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(text("Quick Capture", 0xFFF59E0B.toInt(), 13f, bold = true))
            .addContent(spacer(8f))
            .addContent(micButton)
            .addContent(spacer(8f))
        if (last != null) {
            column.addContent(text("${WatchData.typeIcon(last.type)} ${last.title}", 0xFFFFFFFF.toInt(), 13f))
            column.addContent(text(WatchData.ago(last.createdAt).let { if (it == "now") "just now" else "$it ago" }, 0x99FFFFFF.toInt(), 11f))
        } else {
            column.addContent(text("Tap to record", 0xB3FFFFFF.toInt(), 13f))
        }
        if (openErrands > 0) {
            column.addContent(spacer(4f))
            column.addContent(text("🛒 $openErrands open errand${if (openErrands == 1) "" else "s"}", 0xFF34D399.toInt(), 12f))
        }

        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .addContent(column.build())
            .build()
    }
}
