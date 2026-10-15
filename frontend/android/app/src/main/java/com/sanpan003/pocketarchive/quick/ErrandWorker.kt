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
            ACTION_SYNC -> { ErrandSync.syncBlocking(ctx); Result.success() }
            ACTION_DONE -> {
                if (id == null) return Result.failure()
                if (!ErrandSync.post(ctx, "/api/quick/$id/done", JSONObject().put("done", true))) return Result.retry()
                ErrandSync.syncBlocking(ctx)
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

    companion object {
        private const val KEY_ACTION = "action"
        private const val KEY_ID = "id"
        private const val KEY_PLACE = "place"
        private const val ACTION_SYNC = "sync"
        private const val ACTION_DONE = "done"
        private const val ACTION_TRIGGERED = "triggered"
        private const val ACTION_SNOOZE = "snooze"
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

        fun markDone(ctx: Context, id: String) = enqueueNetwork(ctx, "errand-done-$id", ACTION_DONE, id)

        fun reportTriggered(ctx: Context, id: String) = enqueueNetwork(ctx, "errand-triggered-$id", ACTION_TRIGGERED, id)

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

        private fun enqueueNetwork(ctx: Context, name: String, action: String, id: String) {
            val request = OneTimeWorkRequestBuilder<ErrandWorker>()
                .setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .setInputData(workDataOf(KEY_ACTION to action, KEY_ID to id))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
