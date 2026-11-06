package org.nimbus.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

// Notifications with the app closed. A push (from ntfy or another UnifiedPush distributor) carries no text:
// it only wakes PushWorker, which asks the server for the real notifications. With no distributor chosen,
// the same worker runs every 15 minutes instead. Each account is one UnifiedPush instance, named by its id.
object Push {
  // (account id, endpoint or null when dropped) -> the JS "push" event. Null while the app isn't running.
  @Volatile var listener: ((String, String?) -> Unit)? = null

  private const val POLL = "push-poll"
  private fun prefs(c: Context) = c.getSharedPreferences("nimbus_push", Context.MODE_PRIVATE)

  fun endpoint(c: Context, account: String): String? = prefs(c).getString("endpoint.$account", null)
  fun setEndpoint(c: Context, account: String, url: String?) = prefs(c).edit().apply { if (url == null) remove("endpoint.$account") else putString("endpoint.$account", url) }.apply()
  fun lastShown(c: Context, account: String): String? = prefs(c).getString("last.$account", null)
  fun setLastShown(c: Context, account: String, at: String) = prefs(c).edit().putString("last.$account", at).apply()

  private fun label(c: Context, pkg: String) = try {
    c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) { pkg }

  private fun distributors(c: Context): List<Pair<String, String>> = UnifiedPush.getDistributors(c).map { it to label(c, it) }

  // {saved: {id, name} | null, distributors: [{id, name}]}
  private fun state(c: Context): JSONObject {
    val saved = UnifiedPush.getSavedDistributor(c)
    return JSONObject()
      .put("saved", saved?.let { JSONObject().put("id", it).put("name", label(c, it)) } ?: JSONObject.NULL)
      .put("distributors", JSONArray(distributors(c).map { JSONObject().put("id", it.first).put("name", it.second) }))
  }

  // Safe to call often: picks the only distributor when none is chosen, and keeps the poll in step.
  fun refresh(c: Context): String {
    if (UnifiedPush.getSavedDistributor(c) == null) distributors(c).singleOrNull()?.let { UnifiedPush.saveDistributor(c, it.first) }
    syncPolling(c)
    return state(c).toString()
  }

  fun setDistributor(c: Context, id: String) {
    if (UnifiedPush.getSavedDistributor(c) != id) {
      runCatching { UnifiedPush.removeDistributor(c) } // unregisters every account from the old one
      Accounts.all(c).forEach { setEndpoint(c, it.id, null) }
    }
    UnifiedPush.saveDistributor(c, id)
    syncPolling(c)
  }

  fun register(c: Context, account: String) {
    try { UnifiedPush.register(c, account) } catch (_: Exception) {} // no distributor yet: JS asks again once there is one
  }

  fun unregister(c: Context, account: String) {
    runCatching { UnifiedPush.unregister(c, account) }
    setEndpoint(c, account, null)
    prefs(c).edit().remove("last.$account").apply()
    syncPolling(c)
  }

  // Polling is the fallback: only while there are accounts and no distributor or live connection.
  fun syncPolling(c: Context) {
    val wm = WorkManager.getInstance(c)
    if (UnifiedPush.getSavedDistributor(c) != null || Live.isOn(c) || Accounts.all(c).isEmpty()) {
      wm.cancelUniqueWork(POLL)
      return
    }
    val req = PeriodicWorkRequestBuilder<PushWorker>(15, TimeUnit.MINUTES)
      .setInitialDelay(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    wm.enqueueUniquePeriodicWork(POLL, ExistingPeriodicWorkPolicy.KEEP, req)
  }

  // A push arrived: fetch now, expedited so the notification shows promptly.
  fun fetch(c: Context, account: String) {
    val req = OneTimeWorkRequestBuilder<PushWorker>()
      .setInputData(Data.Builder().putString("account", account).build())
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("push-fetch-$account", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
  }

  // A new endpoint arrived while the app wasn't running: tell the server without waiting for JS.
  fun registerWithServer(c: Context, account: String, url: String) {
    val req = OneTimeWorkRequestBuilder<PushWorker>()
      .setInputData(Data.Builder().putString("account", account).putString("endpoint", url).build())
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("push-register-$account", ExistingWorkPolicy.REPLACE, req)
  }

  fun channels(c: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = c.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(PushRules.SHARING, "Sharing", NotificationManager.IMPORTANCE_DEFAULT))
    nm.createNotificationChannel(NotificationChannel(PushRules.DROPS, "File drops & edits", NotificationManager.IMPORTANCE_DEFAULT))
    nm.createNotificationChannel(NotificationChannel(PushRules.ACCOUNT, "Account & security", NotificationManager.IMPORTANCE_DEFAULT))
  }

  // Live, UnifiedPush and the poll can overlap: one check per account at a time, so nothing shows twice.
  private val locks = ConcurrentHashMap<String, Any>()

  // Shows what's new for one account. Returns normally when there's nothing to do; IOException means try again.
  fun check(c: Context, account: Accounts.Account, named: Boolean, http: okhttp3.OkHttpClient = Net.client) = synchronized(locks.getOrPut(account.id) { Any() }) {
    val items = PushRules.parse(Net.api(account, "GET", "/api/v1/notifications", null, http))
    val last = lastShown(c, account.id)
    val fresh = PushRules.fresh(items, last)
    PushRules.newest(items)?.let { if (last == null || it > last) setLastShown(c, account.id, it) }
    if (fresh.isEmpty() || !NotificationManagerCompat.from(c).areNotificationsEnabled()) return@synchronized
    channels(c)
    fresh.forEach { show(c, account, it, named) }
  }

  private fun show(c: Context, account: Accounts.Account, item: PushRules.Item, named: Boolean) {
    // Tapping opens nimbus://open-notification, which JS (src/app/open-notification.tsx) turns into the right screen.
    val uri = Uri.Builder().scheme("nimbus").authority("open-notification")
      .appendQueryParameter("account", account.id).appendQueryParameter("kind", item.kind).appendQueryParameter("href", item.href)
      .apply { item.nodeId?.let { appendQueryParameter("node", it) } }.build()
    val id = item.id.hashCode()
    val open = PendingIntent.getActivity(c, id, Intent(Intent.ACTION_VIEW, uri).setPackage(c.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val n = NotificationCompat.Builder(c, PushRules.channelFor(item.kind))
      .setSmallIcon(R.drawable.ic_stat_nimbus)
      .setColor(0xFF5FD0BB.toInt())
      .setContentTitle(if (named && account.email.isNotEmpty()) "Nimbus · ${account.email}" else "Nimbus")
      .setContentText(item.text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(item.text))
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    try { NotificationManagerCompat.from(c).notify(id, n) } catch (_: SecurityException) {}
  }
}

// Fetch (a push arrived, or the 15-minute poll) or register an endpoint with the server, for one account or all.
class PushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val ctx = context.applicationContext

  // Expedited work on Android 11 and older runs as a foreground service and needs a notification.
  override suspend fun getForegroundInfo(): ForegroundInfo {
    Notify.channels(ctx)
    val n = Notify.progress(ctx, "Checking Nimbus", 0, 0)
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(Notify.PUSH_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(Notify.PUSH_ID, n)
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val all = Accounts.all(ctx)
    val only = inputData.getString("account")
    val accounts = if (only == null) all else all.filter { it.id == only }
    val endpoint = inputData.getString("endpoint")
    var again = false
    for (a in accounts) try {
      if (endpoint != null) Net.api(a, "POST", "/api/v1/push", JSONObject().put("endpoint", endpoint))
      else Push.check(ctx, a, all.size > 1)
    } catch (e: Refused) {
      // Signed out or refused: retrying the same request won't help.
      Log.w("NimbusPush", "refused for ${a.id}: $e")
    } catch (e: IOException) {
      Log.w("NimbusPush", "network failure for ${a.id}: $e")
      again = true
    } catch (e: Exception) {
      // An answer we can't read: the next push or poll tries afresh.
      Log.w("NimbusPush", "unreadable answer for ${a.id}: $e")
    }
    if (again && runAttemptCount < 3) Result.retry() else Result.success()
  }
}

class NimbusPushService : PushService() {
  private val QUICK = Net.client.newBuilder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).build()

  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    Push.setEndpoint(this, instance, endpoint.url)
    val live = Push.listener
    if (live != null) live(instance, endpoint.url) else Push.registerWithServer(this, instance, endpoint.url)
  }

  // The connector has just raised the app, so the network works now (Android 15 blocks it for a worker that
  // starts later): check right here, and only fall back to the worker when that fails on the network.
  override fun onMessage(message: PushMessage, instance: String) {
    val account = Accounts.get(this, instance) ?: return
    val named = Accounts.all(this).size > 1
    // The distributor holds us in the foreground for a few seconds, but Android lifts its background network
    // block a moment after that starts, so the first try can fail. Retry inside the window, then hand to WorkManager.
    Thread {
      for (attempt in 1..4) {
        try {
          Push.check(this, account, named, QUICK)
          return@Thread
        } catch (e: IOException) {
          Log.w("NimbusPush", "push check for $instance failed (try $attempt): $e")
          if (attempt < 4) Thread.sleep(1_000)
        } catch (e: Exception) {
          Log.w("NimbusPush", "push check for $instance failed: $e")
          return@Thread
        }
      }
      Push.fetch(this, instance)
    }.start()
  }

  // Nothing to do: JS asks for the endpoint again the next time the app opens.
  override fun onRegistrationFailed(reason: FailedReason, instance: String) {}

  override fun onUnregistered(instance: String) {
    Push.setEndpoint(this, instance, null)
    Push.listener?.invoke(instance, null)
    Push.syncPolling(this)
  }
}
