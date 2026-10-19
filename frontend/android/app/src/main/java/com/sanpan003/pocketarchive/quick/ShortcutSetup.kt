package com.sanpan003.pocketarchive.quick

import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.sanpan003.pocketarchive.MainActivity
import com.sanpan003.pocketarchive.R
import org.json.JSONObject

/**
 * Settings → Recording & shortcuts: status of each way to start recording and
 * "Open settings" deep links. Samsung screens are tried by component name and
 * fall back to a broader screen when Android/One UI doesn't allow the exact one.
 */
object ShortcutSetup {
    private const val ROUTINES = "com.samsung.android.app.routines"
    private const val WEARABLE = "com.samsung.android.app.watchmanager"

    fun status(ctx: Context): JSONObject {
        val widgets = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, QuickToggleWidget::class.java)).size
        val pinned = runCatching {
            ctx.getSystemService(ShortcutManager::class.java)?.pinnedShortcuts?.any { it.id == "quick_record_pin" } == true
        }.getOrDefault(false)
        return JSONObject()
            .put("samsung", Build.MANUFACTURER.equals("samsung", ignoreCase = true))
            .put("sdk", Build.VERSION.SDK_INT)
            .put("widgets", widgets)
            .put("shortcutPinned", pinned)
            .put("canPinShortcut", runCatching { ctx.getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true }.getOrDefault(false))
            .put("canPinWidget", AppWidgetManager.getInstance(ctx).isRequestPinAppWidgetSupported)
            .put("canAddTile", Build.VERSION.SDK_INT >= 33)
            .put("routinesInstalled", installed(ctx, ROUTINES))
            .put("wearableInstalled", installed(ctx, WEARABLE))
            .put("watchKnown", WearBridge.watchAppKnown(ctx))
            .put("doublePressService", VolumeShortcutService.isEnabled(ctx))
            .put("batteryUnrestricted", ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true)
            .put("recording", RecorderState.recording)
            .put("accidentalWeek", AccidentalStore.weekCount(ctx))
            .put("lastGuardDecision", RecorderGuard.lastDecision)
    }

    private fun installed(ctx: Context, pkg: String) = runCatching { ctx.packageManager.getPackageInfo(pkg, 0); true }.getOrDefault(false)

    /** Returns "exact" when the right screen opened, "fallback" for a broader one, "none" otherwise. */
    fun open(ctx: Context, target: String): String {
        val exact: List<Intent> = when (target) {
            "sideKey" -> listOf(
                component("com.android.settings", "com.android.settings.Settings\$FunctionKeyDoublePressSettingsActivity"),
                component("com.android.settings", "com.android.settings.Settings\$FunctionKeySettingsActivity"),
            )
            "routines" -> listOfNotNull(ctx.packageManager.getLaunchIntentForPackage(ROUTINES))
            "wearable" -> listOfNotNull(ctx.packageManager.getLaunchIntentForPackage(WEARABLE))
            "battery" -> listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))
            "accessibility" -> buildList {
                if (Build.VERSION.SDK_INT >= 33) add(Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
                    .putExtra(Intent.EXTRA_COMPONENT_NAME, ComponentName(ctx, VolumeShortcutService::class.java).flattenToString()))
                add(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            "assistant" -> listOf(Intent(Intent.ACTION_VOICE_COMMAND))
            else -> emptyList()
        }
        val fallback: List<Intent> = when (target) {
            "sideKey" -> listOf(component("com.android.settings", "com.android.settings.Settings\$UsefulFeatureMainActivity"), Intent(Settings.ACTION_SETTINGS))
            "routines", "wearable" -> listOf(Intent(Settings.ACTION_SETTINGS))
            else -> emptyList()
        }
        for (i in exact) if (launch(ctx, i)) return "exact"
        for (i in fallback) if (launch(ctx, i)) return "fallback"
        return "none"
    }

    private fun component(pkg: String, cls: String) = Intent().setComponent(ComponentName(pkg, cls))

    private fun launch(ctx: Context, intent: Intent): Boolean = try {
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: Exception) { false } // not there, or not exported on this One UI version

    /** "Add widget": the launcher's own pin dialog */
    fun pinWidget(ctx: Context): Boolean = runCatching {
        AppWidgetManager.getInstance(ctx).requestPinAppWidget(ComponentName(ctx, QuickToggleWidget::class.java), null, null)
    }.getOrDefault(false)

    /** "Add to home screen": a Quick Record shortcut icon */
    fun pinQuickRecord(ctx: Context): Boolean = runCatching {
        val sm = ctx.getSystemService(ShortcutManager::class.java) ?: return false
        val info = ShortcutInfo.Builder(ctx, "quick_record_pin")
            .setShortLabel(ctx.getString(R.string.quick_record_label))
            .setIcon(Icon.createWithResource(ctx, R.mipmap.ic_quick_record))
            .setIntent(Intent(ctx, MainActivity::class.java).setAction(QuickActions.ACTION_START_RECORDING))
            .build()
        sm.requestPinShortcut(info, null)
    }.getOrDefault(false)

    /** "Add tile" (Android 13+): the system's add-tile dialog */
    fun addTile(ctx: Context, done: (String) -> Unit) {
        if (Build.VERSION.SDK_INT < 33) return done("unsupported")
        val sbm = ctx.getSystemService(StatusBarManager::class.java) ?: return done("unsupported")
        sbm.requestAddTileService(
            ComponentName(ctx, QuickCaptureTileService::class.java),
            ctx.getString(R.string.tile_label),
            Icon.createWithResource(ctx, R.drawable.ic_stat_mic),
            ctx.mainExecutor,
        ) { result ->
            done(when (result) {
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already"
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "declined"
                else -> "error"
            })
        }
    }
}
