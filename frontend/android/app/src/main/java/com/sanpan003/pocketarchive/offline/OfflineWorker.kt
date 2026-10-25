package com.sanpan003.pocketarchive.offline

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * The offline copy in the background: every 15 minutes with a network (changes since last time, queued changes,
 * media), and right away when asked (Sync now, back online, the app opened). A big first download continues in
 * rounds of up to 8 minutes until it's done. Nothing runs while the app is locked (the copy can't be opened then).
 */
class OfflineWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val reason = inputData.getString("reason") ?: "background"
        val stop = OfflineStore.runSync(applicationContext, reason, System.currentTimeMillis() + 8 * 60_000L)
        if (stop == SyncEngine.Stop.TIME) now(applicationContext, "continue")
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "offline-sync"
        private const val NOW = "offline-sync-now"

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<OfflineWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun now(ctx: Context, reason: String) {
            val req = OneTimeWorkRequestBuilder<OfflineWorker>()
                .setInputData(androidx.work.workDataOf("reason" to reason))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .apply { if (reason != "continue") setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST) }
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(ctx).cancelUniqueWork(NOW)
        }
    }
}
