package com.sanpan003.pocketarchive.quick

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Background work for errands:
 * - sync: refresh the errand list and geofences (every 30 min with network, after
 *   captures, app open, reboot and app updates)
 * - done: "Done" tapped on an arrival notification → mark the errand done on the server
 * - triggered: tell the server an arrival reminder fired (only the errand id — no place, no location)
 * - snooze: show the arrival reminder again after "Snooze 1 hr"
 */
class ErrandWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        val id = inputData.getString(KEY_ID)
        return when (inputData.getString(KEY_ACTION)) {
            ACTION_SYNC -> {
                // Location services turned back on since the last sync: geofences were dropped, add them again
                val locOn = runCatching { ctx.getSystemService(android.location.LocationManager::class.java)?.isLocationEnabled == true }.getOrDefault(true)
                val prefs = ctx.getSharedPreferences("geofence_sig", Context.MODE_PRIVATE)
                if (locOn && !prefs.getBoolean("locOn", true)) ErrandSync.forceRearm(ctx)
                prefs.edit().putBoolean("locOn", locOn).apply()
                ErrandSync.syncBlocking(ctx)
                ReminderAlarms.syncBlocking(ctx) // timed reminders → local alarms (2.12.0)
                // Fallback check with whatever location the phone already has (no extra GPS use)
                LocationCheck.currentLocation(ctx, fresh = false)?.let { LocationCheck.check(ctx, it, "sync") }
                sendEvents(ctx)
                WearBridge.syncState(ctx) // watch: recent notes + open errands
                Result.success()
            }
            ACTION_EVENTS -> if (sendEvents(ctx)) Result.success() else Result.retry()
            ACTION_DONE -> {
                if (id == null) return Result.failure()
                if (!ErrandSync.post(ctx, "/api/quick/$id/done", JSONObject().put("done", true))) return Result.retry()
                deleteDataItem(ctx)
                ErrandSync.syncBlocking(ctx)
                WidgetData.refreshBlocking(ctx)
                WearBridge.syncState(ctx)
                Result.success()
            }
            ACTION_CAPTURE -> {
                val choice = inputData.getString(KEY_CHOICE)
                if (id == null || choice == null) return Result.failure()
                val (done, json) = if (choice == "undo") ErrandSync.requestJson(ctx, "POST", "/api/quick/$id/undo")
                else ErrandSync.requestJson(ctx, "POST", "/api/quick/$id/decide", JSONObject().put("choice", choice))
                if (!done) return Result.retry()
                when {
                    choice == "undo" && json != null -> ResultNotifier.undone(ctx)
                    json != null -> ResultNotifier.deliver(ctx, json, fromQueue = false) // the new outcome (+ watch)
                }
                ErrandSync.syncBlocking(ctx)
                WidgetData.refreshBlocking(ctx)
                WearBridge.syncState(ctx)
                Result.success()
            }
            ACTION_ITEM -> {
                val itemId = inputData.getString(KEY_ITEM)
                if (id == null || itemId == null) return Result.failure()
                val body = JSONObject().put("action", "toggle").put("itemId", itemId).put("done", inputData.getBoolean(KEY_DONE, true))
                if (!ErrandSync.request(ctx, "PATCH", "/api/quick/$id/items", body)) return Result.retry()
                deleteDataItem(ctx) // tells the watch it's applied
                ErrandSync.syncBlocking(ctx) // arrival notification shows the current list
                WearBridge.syncState(ctx)
                WidgetData.refreshBlocking(ctx)
                Result.success()
            }
            ACTION_TRIGGERED -> {
                if (id == null) return Result.failure()
                if (ErrandSync.post(ctx, "/api/errands/$id/triggered")) Result.success() else Result.retry()
            }
            ACTION_SNOOZE -> {
                val errand = id?.let { ErrandStore.errand(ctx, it) }
                if (errand != null && !ErrandStore.isLocallyDone(ctx, errand.id)) {
                    ArrivalNotifier.show(ctx, errand, inputData.getString(KEY_PLACE))
                }
                Result.success()
            }
            else -> Result.failure()
        }
    }

    /** Geofence / fallback events → the server's log (type, time, place id; never the phone's location). */
    private fun sendEvents(ctx: Context): Boolean {
        val events = ErrandStore.takePendingEvents(ctx)
        if (events.length() == 0) return true
        val (done, _) = ErrandSync.requestJson(ctx, "POST", "/api/location-reminders/events", JSONObject().put("events", events))
        if (!done) ErrandStore.requeueEvents(ctx, events)
        return done
    }

    /** Remove the watch's Data Layer item once its change reached the server. */
    private fun deleteDataItem(ctx: Context) {
        val uri = inputData.getString(KEY_DATA_URI)?.takeIf { it.isNotBlank() } ?: return
        runCatching {
            com.google.android.gms.tasks.Tasks.await(
                com.google.android.gms.wearable.Wearable.getDataClient(ctx).deleteDataItems(android.net.Uri.parse(uri)),
                10, TimeUnit.SECONDS,
            )
        }
    }

    companion object {
        private const val KEY_ACTION = "action"
        private const val KEY_ID = "id"
        private const val KEY_PLACE = "place"
        private const val ACTION_SYNC = "sync"
        private const val ACTION_DONE = "done"
        private const val ACTION_TRIGGERED = "triggered"
        private const val ACTION_SNOOZE = "snooze"
        private const val ACTION_ITEM = "item"
        private const val ACTION_CAPTURE = "capture"
        private const val ACTION_EVENTS = "events"
        private const val KEY_CHOICE = "choice"
        private const val KEY_ITEM = "itemId"
        private const val KEY_DONE = "done"
        private const val KEY_DATA_URI = "dataUri"
        private const val PERIODIC = "errand-sync"
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedulePeriodic(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<ErrandWorker>(30, TimeUnit.MINUTES)
                .setConstraints(network)
                .setInputData(workDataOf(KEY_ACTION to ACTION_SYNC))
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Re-sync now; works offline too (re-arms the cached list). */
        fun syncNow(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<ErrandWorker>()
                .setInputData(workDataOf(KEY_ACTION to ACTION_SYNC))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("errand-sync-now", ExistingWorkPolicy.REPLACE, request)
        }

        fun markDone(ctx: Context, id: String, dataUri: String? = null) =
            enqueueNetwork(ctx, "errand-done-$id", ACTION_DONE, id, workDataOf(KEY_DATA_URI to dataUri))

        /** Smart append from a notification / the widget / the watch: "undo", "yes" or "new". */
        fun captureAction(ctx: Context, captureId: String, choice: String) =
            enqueueNetwork(ctx, "capture-$choice-$captureId", ACTION_CAPTURE, captureId, workDataOf(KEY_CHOICE to choice))

        /** Checklist item checked on the watch → PATCH /api/quick/:id/items (retries until online). */
        fun toggleItem(ctx: Context, id: String, itemId: String, done: Boolean, dataUri: String) =
            enqueueNetwork(ctx, "errand-item-$id-$itemId", ACTION_ITEM, id, workDataOf(KEY_ITEM to itemId, KEY_DONE to done, KEY_DATA_URI to dataUri))

        fun reportTriggered(ctx: Context, id: String) = enqueueNetwork(ctx, "errand-triggered-$id", ACTION_TRIGGERED, id)

        /** Upload queued geofence events (KEEP: a waiting upload takes everything queued by then). */
        fun uploadEvents(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<ErrandWorker>()
                .setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
                .setInputData(workDataOf(KEY_ACTION to ACTION_EVENTS))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("errand-events", ExistingWorkPolicy.KEEP, request)
        }

        fun snooze(ctx: Context, id: String, place: String?, delayMs: Long) {
            val request = OneTimeWorkRequestBuilder<ErrandWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf(KEY_ACTION to ACTION_SNOOZE, KEY_ID to id, KEY_PLACE to place))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("errand-snooze-$id", ExistingWorkPolicy.REPLACE, request)
        }

        fun cancelAll(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
        }

        private fun enqueueNetwork(ctx: Context, name: String, action: String, id: String, extra: androidx.work.Data? = null) {
            val data = androidx.work.Data.Builder()
                .apply { if (extra != null) putAll(extra) }
                .putString(KEY_ACTION, action)
                .putString(KEY_ID, id)
                .build()
            val request = OneTimeWorkRequestBuilder<ErrandWorker>()
                .setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .setInputData(data)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
