package org.nimbus.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notify {
  const val PROGRESS_ID = 4100
  const val ALERT_ID = 4101
  const val BACKUP_ID = 4103
  private const val PROGRESS = "uploads"
  private const val ALERTS = "upload-alerts"

  fun channels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(PROGRESS, "Uploads", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    nm.createNotificationChannel(NotificationChannel(ALERTS, "Upload problems", NotificationManager.IMPORTANCE_DEFAULT))
  }

  private fun open(context: Context) = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
    PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun progress(context: Context, title: String, done: Long, total: Long) =
    NotificationCompat.Builder(context, PROGRESS)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(open(context))
      .setProgress(1000, if (total > 0) (done * 1000 / total).toInt() else 0, total <= 0)
      .build()

  // Only when someone needs to act; ordinary waiting stays quiet.
  fun alert(context: Context, title: String, text: String) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val n = NotificationCompat.Builder(context, ALERTS)
      .setSmallIcon(android.R.drawable.stat_notify_error)
      .setContentTitle(title)
      .setContentText(text)
      .setAutoCancel(true)
      .setContentIntent(open(context))
      .build()
    try { NotificationManagerCompat.from(context).notify(ALERT_ID, n) } catch (_: SecurityException) {}
  }
}
