package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.sanpan003.pocketarchive.R
import org.json.JSONObject

/**
 * Tells you what happened to a recording. When the app is open on screen it
 * shows its own toast (the event goes to the web layer); otherwise a short,
 * auto-dismissing notification with a vibration pattern.
 */
object ResultNotifier {
    private const val TAG = "QuickRecorder"
    private const val TIMEOUT_MS = 4000L

    fun deliver(ctx: Context, response: JSONObject, fromQueue: Boolean) {
        val conf = response.optJSONObject("confirmation")
        val icon = conf?.optString("icon")?.takeIf { it.isNotBlank() } ?: "📝"
        val text = conf?.optString("text")?.takeIf { it.isNotBlank() } ?: "Voice note saved"
        val tone = conf?.optString("tone") ?: "success"
        val detail = conf?.takeIf { !it.isNull("detail") }?.optString("detail")?.takeIf { it.isNotBlank() }

        val payload = JSObject().apply {
            put("note", response.optJSONObject("note"))
            put("spokenConfirmation", response.optString("spokenConfirmation"))
            put("confirmation", conf)
            put("fromQueue", fromQueue)
        }
        WidgetState.result(ctx, "$icon $text", response.optJSONObject("note")?.optString("id")?.takeIf { it.isNotBlank() })
        WidgetData.refreshAsync(ctx)
        ErrandWorker.syncNow(ctx) // a new errand may need geofences (and the watch a fresh list)

        // Recorded on the watch: show the result there. The phone's own
        // notification then stays on the phone (no duplicate on the wrist).
        val clientId = response.optJSONObject("note")?.optString("clientId")
        val fromWatch = clientId?.startsWith(WearBridge.CLIENT_PREFIX) == true
        val shownOnWatch = fromWatch && WearBridge.sendResult(
            ctx, clientId,
            conf ?: JSONObject().put("icon", icon).put("text", text).put("tone", tone),
        )
        if (QuickRecorderPlugin.deliverToApp("result", payload)) return

        post(ctx, "$icon $text", detail ?: if (fromWatch) "From your watch" else if (fromQueue) "Sent from queue" else null, tone, localOnly = shownOnWatch)
    }

    fun queued(ctx: Context, reason: String) {
        WidgetState.result(ctx, "🕓 Queued — will send when online")
        if (QuickRecorderPlugin.deliverToApp("queued", JSObject().put("reason", reason))) return
        post(ctx, "🕓 Queued — will send when online", reason, "queued")
    }

    fun empty(ctx: Context) {
        WidgetState.result(ctx, "🎙️ Didn't hear anything")
        if (QuickRecorderPlugin.deliverToApp("empty", JSObject())) return
        post(ctx, "🎙️ Didn't hear anything", "Nothing was saved", "review")
    }

    fun failed(ctx: Context, reason: String, watchClientId: String? = null) {
        WidgetState.result(ctx, "⚠️ Couldn't save voice note")
        val shownOnWatch = watchClientId != null && WearBridge.sendResult(
            ctx, watchClientId,
            JSONObject().put("icon", "⚠️").put("text", "Couldn't save voice note").put("tone", "review").put("detail", reason),
        )
        if (QuickRecorderPlugin.deliverToApp("error", JSObject().put("message", reason))) return
        post(ctx, "⚠️ Couldn't save voice note", reason, "review", localOnly = shownOnWatch)
    }

    private fun post(ctx: Context, title: String, text: String?, tone: String, localOnly: Boolean = false) {
        Notifications.ensureChannels(ctx)
        val success = tone == "success"
        val channel = when {
            !TokenStore.feedbackEnabled(ctx) -> Notifications.CH_RESULT_SILENT
            success -> Notifications.CH_RESULT_OK
            else -> Notifications.CH_RESULT_REVIEW
        }
        val color = when (tone) {
            "success" -> Notifications.GREEN
            "queued" -> Notifications.GREY
            else -> Notifications.AMBER
        }
        // Lock screen shows a generic line; details after unlocking
        val publicVersion = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(color)
            .setContentTitle(if (success) "✓ Voice note saved" else if (tone == "queued") "🕓 Voice note queued" else "⚠️ Voice note needs attention")
            .build()

        val notification = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setColor(color)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setTimeoutAfter(TIMEOUT_MS)
            .setContentIntent(Notifications.openApp(ctx, "/quick/inbox"))
            .setLocalOnly(localOnly) // already shown by the watch app
            .build()

        if (!Notifications.canPost(ctx)) {
            // Notifications blocked: still give the vibration cue
            if (success) Feedback.success(ctx) else Feedback.warning(ctx)
            return
        }
        try {
            NotificationManagerCompat.from(ctx).notify(Notifications.ID_RESULT, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission missing", e)
        }
    }
}
