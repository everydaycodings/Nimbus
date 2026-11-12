package org.nimbus.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.util.Calendar
import java.util.concurrent.TimeUnit

// The decisions of the daily On this day notice, free of Android so a plain JUnit test can run them.
object MemoriesRules {
  // Milliseconds from `now` to the next hour:minute, today if it's still ahead, else tomorrow.
  fun delayMs(now: Calendar, hour: Int, minute: Int): Long {
    val next = (now.clone() as Calendar).apply {
      set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    if (!next.after(now)) next.add(Calendar.DAY_OF_YEAR, 1)
    return next.timeInMillis - now.timeInMillis
  }

  // The phone's date, the way GET /api/v1/photos/memories?date= wants it.
  fun date(now: Calendar) = "%04d-%02d-%02d".format(now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH))

  data class Found(val photos: Int, val yearsAgo: List<Int>)

  // MemoriesResponse: {date, years: [{year, yearsAgo, items: []}]}. Null when there is nothing to remember.
  fun parse(body: JSONObject): Found? {
    val years = body.optJSONArray("years") ?: return null
    var photos = 0
    val ago = ArrayList<Int>()
    for (i in 0 until years.length()) {
      val y = years.getJSONObject(i)
      val n = y.optJSONArray("items")?.length() ?: 0
      if (n > 0) { photos += n; ago.add(y.optInt("yearsAgo")) }
    }
    return if (photos == 0) null else Found(photos, ago.sorted())
  }

  fun text(f: Found): String {
    val what = if (f.photos == 1) "1 photo" else "${f.photos} photos"
    val a = f.yearsAgo
    val when_ = when {
      a.size == 1 -> if (a[0] == 1) "1 year ago" else "${a[0]} years ago"
      else -> a.dropLast(1).joinToString(", ") + " and ${a.last()} years ago"
    }
    return "$what from $when_"
  }
}

// A notice once a day at the chosen time: the phone asks each account for memories and shows one only when there are some.
// Scheduled as a chain of one-time work (a periodic job drifts and can't aim at a clock time); each run books the next.
object Memories {
  private const val WORK = "memories-daily"
  private const val CHANNEL = "memories"
  private fun prefs(c: Context) = c.getSharedPreferences("nimbus_memories", Context.MODE_PRIVATE)

  fun enabled(c: Context) = prefs(c).getBoolean("enabled", false)
  fun hour(c: Context) = prefs(c).getInt("hour", 9)
  fun minute(c: Context) = prefs(c).getInt("minute", 0)
  fun state(c: Context): String = JSONObject().put("enabled", enabled(c)).put("hour", hour(c)).put("minute", minute(c)).toString()

  fun set(c: Context, enabled: Boolean, hour: Int, minute: Int) {
    prefs(c).edit().putBoolean("enabled", enabled).putInt("hour", hour.coerceIn(0, 23)).putInt("minute", minute.coerceIn(0, 59)).apply()
    if (enabled) schedule(c, ExistingWorkPolicy.REPLACE) else WorkManager.getInstance(c).cancelUniqueWork(WORK)
  }

  // KEEP at app start: a chain that is already booked isn't pushed back.
  fun schedule(c: Context, policy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP) {
    if (!enabled(c)) return
    val delay = MemoriesRules.delayMs(Calendar.getInstance(), hour(c), minute(c))
    val req = OneTimeWorkRequestBuilder<MemoriesWorker>()
      .setInitialDelay(delay, TimeUnit.MILLISECONDS)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork(WORK, policy, req)
  }

  // Asks one account; IOException means try again.
  fun check(c: Context, account: Accounts.Account, named: Boolean) {
    val date = MemoriesRules.date(Calendar.getInstance())
    val found = MemoriesRules.parse(Net.api(account, "GET", "/api/v1/photos/memories?date=$date")) ?: return
    if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return
    channel(c)
    // Tapping opens nimbus://open-notification, which JS (src/app/open-notification.tsx) sends to the slideshow.
    val uri = Uri.Builder().scheme("nimbus").authority("open-notification")
      .appendQueryParameter("account", account.id).appendQueryParameter("kind", "memories").appendQueryParameter("href", date).build()
    val id = ("memories" + account.id).hashCode()
    val open = PendingIntent.getActivity(c, id, Intent(Intent.ACTION_VIEW, uri).setPackage(c.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val n = NotificationCompat.Builder(c, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_nimbus)
      .setColor(0xFF5FD0BB.toInt())
      .setContentTitle(if (named && account.email.isNotEmpty()) "On this day · ${account.email}" else "On this day")
      .setContentText(MemoriesRules.text(found))
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    try { NotificationManagerCompat.from(c).notify(id, n) } catch (_: SecurityException) {}
  }

  private fun channel(c: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    c.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "On this day", NotificationManager.IMPORTANCE_DEFAULT))
  }
}

class MemoriesWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val ctx = context.applicationContext

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    // Tomorrow's is booked first, so a failure today doesn't end the chain. A retry of today's has booked it already.
    if (runAttemptCount == 0) Memories.schedule(ctx, ExistingWorkPolicy.APPEND_OR_REPLACE)
    if (!Memories.enabled(ctx)) return@withContext Result.success()
    val all = Accounts.all(ctx)
    var again = false
    for (a in all) try {
      Memories.check(ctx, a, all.size > 1)
    } catch (e: Refused) {
      Log.w("NimbusMemories", "refused for ${a.id}: $e")
    } catch (e: IOException) {
      Log.w("NimbusMemories", "network failure for ${a.id}: $e")
      again = true
    } catch (e: Exception) {
      Log.w("NimbusMemories", "unreadable answer for ${a.id}: $e")
    }
    if (again && runAttemptCount < 3) Result.retry() else Result.success()
  }
}
