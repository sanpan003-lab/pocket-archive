package com.sanpan003.pocketarchive.offline

import org.json.JSONArray
import org.json.JSONObject

/**
 * The widget's and the watch's lists from the offline copy (when the NAS can't be reached) — the same rules as the
 * server's GET /api/quick/recent and GET /api/errands/open (quickCapture.js).
 */
object OfflineViews {
    private val ICON = mapOf("alarm" to "⏰", "timer" to "⏲", "navigate" to "📍", "message" to "💬", "call" to "📞", "dnd" to "🔕", "flashlight" to "🔦", "openApp" to "📱")

    private fun newestFirst(list: List<JSONObject>) = list.sortedByDescending { it.optString("createdAt") }

    fun recent(own: List<JSONObject>, limit: Int, withSummary: Boolean): JSONArray {
        val out = JSONArray()
        newestFirst(own).filter { !it.optBoolean("undone") && (!it.optBoolean("hidden") || it.optString("kind") == "append") }
            .take(limit.coerceIn(1, 20)).forEach { n ->
                val append = n.optString("kind") == "append"
                val applied = n.optJSONObject("appliedTo")
                val o = JSONObject()
                    .put("id", if (append && applied != null) applied.optString("id") else n.getString("id"))
                    .put("title", if (append && n.optString("resultLine").isNotBlank()) n.optString("resultLine") else n.optString("title"))
                    .put("type", if (append && applied != null) (if (applied.optString("type") == "note") "note" else applied.optString("type")) else n.optString("type", "note"))
                    .put("createdAt", n.optString("capturedAt").ifBlank { n.optString("createdAt") })
                    .put("needsReview", n.optString("status") == "needs_review")
                    .put("summaryStatus", n.opt("summaryStatus") ?: JSONObject.NULL)
                if (n.optString("type") == "action") o.put("icon", ICON[n.optJSONObject("action")?.optString("kind")] ?: "⚡")
                if (append) o.put("append", true)
                if (n.optString("status") == "pending_decision") o.put("pending", true)
                if (n.optString("type") == "errand") {
                    val items = n.optJSONArray("items") ?: JSONArray()
                    o.put("itemsTotal", items.length()).put("itemsDone", (0 until items.length()).count { items.getJSONObject(it).optBoolean("done") })
                        .put("errandDone", n.optBoolean("errandDone"))
                }
                if (withSummary) o.put("summary", if (n.optString("summaryStatus") == "done" && n.optString("summary").isNotBlank()) n.optString("summary").take(1500) else JSONObject.NULL)
                out.put(o)
            }
        return out
    }

    fun openErrands(own: List<JSONObject>, shared: List<JSONObject>): JSONArray {
        val out = JSONArray()
        newestFirst(own + shared).filter {
            it.optString("type") == "errand" && !it.optBoolean("undone") && !it.optBoolean("errandDone") && !it.optBoolean("hidden") &&
                !it.optBoolean("cancelled") && it.optString("status") != "pending_decision"
        }.take(20).forEach { n ->
            val place = n.optJSONObject("place")
            val items = n.optJSONArray("items") ?: JSONArray()
            out.put(JSONObject().put("id", n.getString("id")).put("title", n.optString("title"))
                .put("placeName", place?.optString("name")?.ifBlank { place.optString("query") }?.ifBlank { null } ?: JSONObject.NULL)
                .put("address", if (place?.optBoolean("resolved") == true) place.optString("address").ifBlank { null } ?: JSONObject.NULL else JSONObject.NULL)
                .put("whenLabel", JSONObject.NULL)
                .put("arrival", n.optString("trigger") == "arrival" || n.optString("trigger") == "both")
                .put("items", JSONArray((0 until items.length()).map { i -> items.getJSONObject(i).let { JSONObject().put("id", it.optString("id")).put("text", it.optString("text")).put("done", it.optBoolean("done")) } })))
        }
        return out
    }
}
