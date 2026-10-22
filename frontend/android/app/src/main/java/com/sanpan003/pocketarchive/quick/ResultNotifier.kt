package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.sanpan003.pocketarchive.R
import org.json.JSONObject
import android.app.PendingIntent
import android.content.Intent

/**
 * Tells you what happened to a recording. When the app is open on screen it
 * shows its own toast (the event goes to the web layer); otherwise a short,
 * auto-dismissing notification with a vibration pattern.
 */
object ResultNotifier {
    private const val TAG = "QuickRecorder"
    private const val TIMEOUT_MS = 4000L
    private const val UNDO_TIMEOUT_MS = 30_000L        // Undo / Move stay available for 30 s
    private const val ASK_TIMEOUT_MS = 2 * 60_000L     // "Add to …?" — no answer in 2 min → new note

    fun deliver(ctx: Context, response: JSONObject, fromQueue: Boolean) {
        // A phone action ("wake me at 5:30"): do it now; the result replaces the confirmation
        val action = response.optJSONObject("phoneAction")
        val actionOutcome = action?.let { PhoneActions.run(ctx, it) }
        val conf = if (action != null && actionOutcome != null) actionConfirmation(action, actionOutcome, response.optJSONObject("note"))
            else response.optJSONObject("confirmation")
        val icon = conf?.optString("icon")?.takeIf { it.isNotBlank() } ?: "📝"
        val text = conf?.optString("text")?.takeIf { it.isNotBlank() } ?: "Voice note saved"
        val tone = conf?.optString("tone") ?: "success"
        val detail = conf?.takeIf { !it.isNull("detail") }?.optString("detail")?.takeIf { it.isNotBlank() }

        val payload = JSObject().apply {
            put("note", response.optJSONObject("note"))
            put("spokenConfirmation", response.optString("spokenConfirmation"))
            put("confirmation", conf)
            put("fromQueue", fromQueue)
            if (actionOutcome != null) put("actionOutcome", actionOutcome)
        }
        // Smart append: the capture lives inside another note → open that one; Undo/answer by capture id
        val note = response.optJSONObject("note")
        RecordingLog.noteSaved(ctx, note?.optString("clientId"), note?.optString("id"), note?.optString("title"))
        val captureId = conf?.optString("captureId")?.takeIf { it.isNotBlank() } ?: note?.optString("id")
        val ask = tone == "ask"
        val undoable = conf?.optBoolean("undoable") == true && !ask
        val openId = note?.optJSONObject("appliedTo")?.optString("id")?.takeIf { it.isNotBlank() } ?: note?.optString("id")?.takeIf { it.isNotBlank() }
        WidgetState.result(ctx, "$icon $text", openId, captureId.takeIf { ask || undoable }, ask)
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

        post(
            ctx, "$icon $text", detail ?: if (fromWatch) "From your watch" else if (fromQueue) "Sent from queue" else null, tone,
            localOnly = shownOnWatch, captureId = captureId, ask = ask, undoable = undoable,
            undoAction = action?.takeIf { actionOutcome?.optBoolean("undo") == true },
            chooseAction = action?.takeIf { actionOutcome?.optString("status") in setOf("needs_choice", "needs_permission") },
        )
    }

    /** "⏰ Alarm · 5:30 AM set" (+ "Note saved: …" when the capture also kept a note) */
    private fun actionConfirmation(action: JSONObject, out: JSONObject, note: JSONObject?): JSONObject {
        val status = out.optString("status")
        val noteLine = action.optString("noteId").takeIf { it.isNotBlank() && it != "null" }?.let { "Note saved: ${note?.optString("title")}" }
        return JSONObject()
            .put("icon", out.optString("icon", "⚡"))
            .put("text", out.optString("text"))
            .put("tone", if (status == "failed" || status == "needs_permission") "review" else "success")
            .put("detail", listOfNotNull(out.optString("detail").takeIf { it.isNotBlank() }, noteLine).joinToString(" · ").ifBlank { null } ?: JSONObject.NULL)
            .put("actionId", action.optString("id"))
            .apply { if (out.optBoolean("undo")) put("actionUndo", action) }
    }

    /** After Undo from a notification / the widget / the watch */
    fun undone(ctx: Context) {
        WidgetState.result(ctx, "↩️ Undone")
        post(ctx, "↩️ Undone", null, "queued")
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

    private fun post(
        ctx: Context, title: String, text: String?, tone: String, localOnly: Boolean = false,
        captureId: String? = null, ask: Boolean = false, undoable: Boolean = false,
        undoAction: JSONObject? = null, chooseAction: JSONObject? = null,
    ) {
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
            .setTimeoutAfter(if (ask) ASK_TIMEOUT_MS else if (undoable || undoAction != null || chooseAction != null) UNDO_TIMEOUT_MS else TIMEOUT_MS)
            .setContentIntent(Notifications.openApp(ctx, "/quick/inbox"))
            .setLocalOnly(localOnly) // already shown by the watch app
            .apply {
                if (captureId != null && ask) {
                    addAction(0, "Yes", QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_YES, captureId))
                    addAction(0, "New note", QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_NEW, captureId))
                    addAction(0, "Other…", Notifications.openApp(ctx, "/quick/inbox?note=$captureId"))
                } else if (undoAction != null) {
                    // Alarm/timer: Undo opens Clock's list (the alarm is deleted there); flashlight/DND: switched back
                    addAction(0, "Undo", PendingIntent.getBroadcast(
                        ctx, undoAction.optString("id").hashCode(),
                        Intent(ctx, ActionUndoReceiver::class.java).putExtra(ActionUndoReceiver.EXTRA_ACTION, undoAction.toString()),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ))
                    addAction(0, "Actions", Notifications.openApp(ctx, "/quick/actions?focus=${undoAction.optString("id")}"))
                } else if (chooseAction != null) {
                    addAction(0, "Choose", Notifications.openApp(ctx, "/quick/actions?choose=${chooseAction.optString("id")}"))
                } else if (captureId != null && undoable) {
                    addAction(0, "Undo", QuickActionReceiver.intent(ctx, QuickActionReceiver.ACTION_UNDO, captureId))
                    addAction(0, "Move", Notifications.openApp(ctx, "/quick/inbox?move=$captureId"))
                }
            }
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
