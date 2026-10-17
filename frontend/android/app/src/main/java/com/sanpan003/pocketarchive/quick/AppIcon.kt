package com.sanpan003.pocketarchive.quick

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * Settings → App icon: the Purple Neon Bolt on a Dark (default), Light or AMOLED tile.
 * Each tile has its own launcher entries (activity-aliases in the manifest): the app icon,
 * Quick Record and Stop Recording. Exactly one set is enabled. The choice is the enabled
 * component itself, so it survives app updates.
 */
object AppIcon {
    val TILES = listOf("dark", "light", "amoled")
    private const val PKG = "com.sanpan003.pocketarchive"
    private val SUFFIX = mapOf("dark" to "", "light" to "Light", "amoled" to "Amoled")

    /** Launcher entries for a tile: app icon, Quick Record, Stop Recording */
    private fun components(tile: String): List<String> {
        val s = SUFFIX.getValue(tile)
        return listOf("$PKG.AppIcon${if (tile == "dark") "Dark" else s}", "$PKG.QuickRecordLauncher$s", "$PKG.StopRecordLauncher$s")
    }

    private fun enabled(ctx: Context, cls: String, defaultOn: Boolean): Boolean =
        when (ctx.packageManager.getComponentEnabledSetting(ComponentName(PKG, cls))) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> defaultOn
            else -> false
        }

    fun current(ctx: Context): String =
        TILES.firstOrNull { t -> enabled(ctx, components(t).first(), defaultOn = t == "dark") } ?: "dark"

    /** Switch tiles. The new entries are enabled before the old ones are disabled, so there's never no icon. */
    fun set(ctx: Context, tile: String): Boolean {
        if (tile !in TILES) return false
        if (current(ctx) == tile) return true
        val pm = ctx.packageManager
        val set = { cls: String, on: Boolean ->
            pm.setComponentEnabledSetting(
                ComponentName(PKG, cls),
                if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
        components(tile).forEach { set(it, true) }
        TILES.filter { it != tile }.flatMap(::components).forEach { set(it, false) }
        return true
    }
}
