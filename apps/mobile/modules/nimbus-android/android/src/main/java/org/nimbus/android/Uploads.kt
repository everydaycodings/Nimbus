package org.nimbus.android

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

// Thrown inside a running part when the person pauses or cancels it.
class Halted : IOException("halted")

object Uploads {
  // The module's way of telling JS the queue changed. Null while the app's JS isn't running.
  @Volatile var listener: (() -> Unit)? = null
  val halted: MutableSet<String> = ConcurrentHashMap.newKeySet()

  fun publish() = listener?.invoke()

  fun metered(context: Context) = context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered

  // One worker at a time, so two never send the same row: new work queues behind the running one.
  fun schedule(context: Context) {
    val req = OneTimeWorkRequestBuilder<UploadWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("uploads", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
  }

  // Rows held for Wi-Fi: a tiny job that waits for an unmetered network and then starts the real one.
  fun scheduleWifi(context: Context) {
    val req = OneTimeWorkRequestBuilder<WifiTrigger>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("uploads-wifi", ExistingWorkPolicy.KEEP, req)
  }

  // Lets a picked file outlive the picker, where Android allows it. Freed when the upload ends.
  fun hold(context: Context, uri: String) {
    if (!uri.startsWith("content://")) return
    runCatching { context.contentResolver.takePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
  }

  fun release(context: Context, uri: String) {
    Share.forget(context, uri)
    if (!uri.startsWith("content://")) return
    runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
  }

  // Shared by every running upload, so the speed cap is for the whole phone, like the web's.
  private var nextSlot = 0L
  fun pace(bytes: Int, cap: Long) {
    val wait = synchronized(this) {
      val now = System.currentTimeMillis()
      nextSlot = maxOf(now, nextSlot) + bytes * 1000 / cap
      nextSlot - now
    }
    if (wait > 0) Thread.sleep(wait)
  }
}

class WifiTrigger(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    Uploads.schedule(applicationContext)
    return Result.success()
  }
}
