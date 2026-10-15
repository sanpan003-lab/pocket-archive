package com.sanpan003.pocketarchive.quick

import android.content.Context
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
import java.util.concurrent.TimeUnit

/**
 * Keeps the widget's recent-notes list fresh: every 30 minutes while a widget
 * is on the home screen (only with a network), plus a one-off redraw after a
 * result line has been shown.
 */
class WidgetRefreshWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        if (!QuickToggleWidget.hasWidgets(applicationContext)) return Result.success()
        if (inputData.getBoolean(KEY_SETTLE, false)) {
            QuickToggleWidget.updateAll(applicationContext)
        }
        WidgetData.refreshBlocking(applicationContext)
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "widget-refresh"
        private const val SETTLE = "widget-settle"
        private const val KEY_SETTLE = "settle"

        fun schedulePeriodic(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancelPeriodic(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(ctx).cancelUniqueWork(SETTLE)
        }

        /** Redraw (result line → list) after [delayMs], even if this process has died. */
        fun settleLater(ctx: Context, delayMs: Long) {
            if (!QuickToggleWidget.hasWidgets(ctx)) return
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf(KEY_SETTLE to true))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(SETTLE, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
