package org.nimbus.android

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

// Sends the manual queue: three files at a time, in the foreground with a progress notification.
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val store = Store.of(context)
  private val ctx = context.applicationContext
  @Volatile private var stop: String? = null
  @Volatile private var failedNow = 0

  override suspend fun getForegroundInfo() = info()

  private fun info(): ForegroundInfo {
    val (total, done, _) = store.counts()
    val (size, sent) = store.progress()
    val title = if (total > 0) "Uploading ${minOf(total, done + 1)} of $total" else "Uploading"
    val n = Notify.progress(ctx, title, sent, size)
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(Notify.PROGRESS_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else ForegroundInfo(Notify.PROGRESS_ID, n)
  }

  // Android may refuse a foreground service from the background; then it's an ordinary notification.
  private suspend fun show() {
    try { setForeground(info()) } catch (_: Exception) {
      try { NotificationManagerCompat.from(ctx).notify(Notify.PROGRESS_ID, info().notification) } catch (_: SecurityException) {}
    }
  }

  override suspend fun doWork(): Result {
    Notify.channels(ctx)
    store.recover("manual")
    store.markWaiting(Uploads.metered(ctx))
    if (store.pending("manual") == 0) return Result.success()
    show()
    val sender = Sender(ctx) { isStopped }
    coroutineScope {
      val ticker = launch {
        while (isActive) {
          Uploads.publish()
          show()
          delay(1000)
        }
      }
      (1..3).map {
        launch(Dispatchers.IO) {
          while (!isStopped && stop == null) {
            val row = store.claim(Uploads.metered(ctx), "manual") ?: break
            when (sender.send(row)) {
              Sender.Outcome.OFFLINE -> stop = "offline"
              Sender.Outcome.AUTH -> stop = "auth"
              Sender.Outcome.FAILED, Sender.Outcome.FULL -> failedNow++
              else -> {}
            }
          }
        }
      }.joinAll()
      ticker.cancel()
    }
    val metered = Uploads.metered(ctx)
    store.markWaiting(metered)
    store.recover("manual")
    NotificationManagerCompat.from(ctx).cancel(Notify.PROGRESS_ID)
    Uploads.publish()
    if (stop == "auth") {
      Notify.alert(ctx, "Uploads paused: sign in again", "Open Nimbus and sign in to finish your uploads.")
      return Result.success()
    }
    if (failedNow > 0) Notify.alert(ctx, if (failedNow == 1) "1 upload couldn't finish" else "$failedNow uploads couldn't finish", "Open Nimbus to see why and try again.")
    if (stop == "offline" || isStopped) return Result.retry()
    if (metered && store.pending("manual") > 0) Uploads.scheduleWifi(ctx)
    return Result.success()
  }
}
