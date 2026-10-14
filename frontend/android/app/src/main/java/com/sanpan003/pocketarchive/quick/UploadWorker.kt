package com.sanpan003.pocketarchive.quick

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import java.util.concurrent.TimeUnit

/** Retries a recording upload (with backoff, whenever there's a network) until it is sent. */
class UploadWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val path = inputData.getString(KEY_PATH) ?: return Result.failure()
        val file = File(path)
        if (!file.exists()) return Result.success() // already sent by another attempt

        return when (val outcome = Uploader.upload(applicationContext, file)) {
            is UploadOutcome.Sent -> {
                file.delete()
                ResultNotifier.deliver(applicationContext, outcome.response, fromQueue = true)
                QuickRecorderPlugin.notifyPending(applicationContext)
                Result.success()
            }
            is UploadOutcome.Retry -> Result.retry()
            is UploadOutcome.Failed -> {
                file.delete()
                ResultNotifier.failed(applicationContext, outcome.reason)
                QuickRecorderPlugin.notifyPending(applicationContext)
                Result.failure()
            }
        }
    }

    companion object {
        private const val KEY_PATH = "path"
        private const val TAG = "quick-upload"

        fun enqueue(ctx: Context, recording: File, replace: Boolean = false) {
            val file = PendingStore.moveToPending(ctx, recording)
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_PATH to file.absolutePath))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(
                "upload-${file.name}",
                if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                request,
            )
        }

        /** After signing in again: try every waiting recording right away (resets backoff). */
        fun retryAllNow(ctx: Context) {
            PendingStore.pending(ctx).forEach { enqueue(ctx, it, replace = true) }
        }
    }
}
