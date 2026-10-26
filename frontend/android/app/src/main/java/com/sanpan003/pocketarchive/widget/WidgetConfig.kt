package com.sanpan003.pocketarchive.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One widget's settings (each widget on the home screen has its own). Chosen on the configuration screen — when it's
 * added, and from long-press → Settings. `filter` = the chip currently selected (starts at defaultFilter).
 */
data class WidgetConfig(
    val defaultFilter: String = "all",
    val chips: List<String> = listOf("all", "notes", "reminders", "lists", "documents", "shared"),
    val showActions: Boolean = false,
    val sort: String = "newest",            // newest | due
    val density: String = "comfortable",    // compact | comfortable
    val theme: String = "system",           // system | dark | light
    val opacity: Int = 92,                  // background, 0–100 %
    val showTimes: Boolean = true,
    val hideTitles: Boolean = false,
    val upNext: Boolean = true,
    val listId: String? = null,             // the pinned-list widget's list
    val filter: String = defaultFilter,
) {
    fun toJson(): JSONObject = JSONObject().put("defaultFilter", defaultFilter).put("chips", JSONArray(chips)).put("showActions", showActions)
        .put("sort", sort).put("density", density).put("theme", theme).put("opacity", opacity).put("showTimes", showTimes)
        .put("hideTitles", hideTitles).put("upNext", upNext).put("listId", listId ?: JSONObject.NULL).put("filter", filter)

    /** Chips shown: Actions only when switched on */
    val shownChips: List<String> get() = WidgetModel.FILTERS.filter { it in chips && (it != "actions" || showActions) }

    companion object {
        fun fromJson(o: JSONObject?): WidgetConfig {
            if (o == null) return WidgetConfig()
            val d = WidgetConfig()
            val chipsJson = o.optJSONArray("chips")
            val chips = if (chipsJson == null) d.chips else (0 until chipsJson.length()).map { chipsJson.optString(it) }.filter { it in WidgetModel.FILTERS }
            val defaultFilter = o.optString("defaultFilter", "all").takeIf { it in WidgetModel.FILTERS } ?: "all"
            val showActions = o.optBoolean("showActions", false)
            var filter = o.optString("filter", defaultFilter).takeIf { it in WidgetModel.FILTERS } ?: defaultFilter
            if (filter == "actions" && !showActions) filter = "all"
            return WidgetConfig(
                defaultFilter = defaultFilter, chips = chips.ifEmpty { listOf("all") }, showActions = showActions,
                sort = o.optString("sort").takeIf { it == "due" } ?: "newest",
                density = o.optString("density").takeIf { it == "compact" } ?: "comfortable",
                theme = o.optString("theme").takeIf { it == "dark" || it == "light" } ?: "system",
                opacity = o.optInt("opacity", 92).coerceIn(0, 100),
                showTimes = o.optBoolean("showTimes", true), hideTitles = o.optBoolean("hideTitles", false),
                upNext = o.optBoolean("upNext", true),
                listId = o.optString("listId").takeIf { it.startsWith("qn_") },
                filter = filter,
            )
        }

        private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("widget_config", Context.MODE_PRIVATE)
        fun load(ctx: Context, id: Int): WidgetConfig = fromJson(prefs(ctx).getString("w$id", null)?.let { runCatching { JSONObject(it) }.getOrNull() })
        fun save(ctx: Context, id: Int, c: WidgetConfig) = prefs(ctx).edit().putString("w$id", c.toJson().toString()).apply()
        fun exists(ctx: Context, id: Int) = prefs(ctx).contains("w$id")
        fun delete(ctx: Context, id: Int) = prefs(ctx).edit().remove("w$id").apply()
    }
}
