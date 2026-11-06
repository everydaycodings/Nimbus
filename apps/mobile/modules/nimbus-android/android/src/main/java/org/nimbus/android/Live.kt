package org.nimbus.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

// "Instant notifications" without a push app: a foreground service keeps GET /api/v1/events open to each
// signed-in account's own server. An event only says something is new; Push.check fetches and shows it.
object Live {
  private fun prefs(c: Context) = c.getSharedPreferences("nimbus_live", Context.MODE_PRIVATE)
  fun isOn(c: Context) = prefs(c).getBoolean("on", false)

  fun set(c: Context, on: Boolean) {
    prefs(c).edit().putBoolean("on", on).apply()
    Push.syncPolling(c)
    sync(c)
  }

  // Starts (or nudges) the service while it's wanted, stops it otherwise. Safe to call often.
  fun sync(c: Context) {
    try {
      if (isOn(c) && Accounts.all(c).isNotEmpty()) ContextCompat.startForegroundService(c, Intent(c, LiveService::class.java))
      else c.stopService(Intent(c, LiveService::class.java))
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException (Android 12+, app in the background): the next app launch tries again.
      Log.w("NimbusLive", "can't start: $e")
    }
  }

  const val ID = 4106
  private const val CHANNEL = "connection"

  fun notification(c: Context): Notification {
    if (Build.VERSION.SDK_INT >= 26)
      c.getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(CHANNEL, "Connection", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    val open = c.packageManager.getLaunchIntentForPackage(c.packageName)?.let {
      PendingIntent.getActivity(c, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return NotificationCompat.Builder(c, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_nimbus)
      .setColor(0xFF5FD0BB.toInt())
      .setContentTitle("Connected to Nimbus")
      .setContentText("Instant notifications are on")
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(open)
      .build()
  }
}

class LiveService : Service() {
  // One thread per account, reading that server's event stream until it's stopped.
  private class Conn(val ctx: Context, val account: Accounts.Account) : Thread("nimbus-live-${account.id}") {
    @Volatile var running = true
    @Volatile private var call: okhttp3.Call? = null
    private val gate = Object()

    fun kick() = synchronized(gate) { gate.notifyAll() }
    fun end() { running = false; call?.cancel(); kick() }

    private fun pause(ms: Long) = synchronized(gate) { if (running) try { gate.wait(ms) } catch (_: InterruptedException) {} }

    private fun check(all: Int) {
      try {
        Push.check(ctx, account, all > 1)
      } catch (e: Refused) {
        if (e.status == 401) running = false
      }
    }

    override fun run() {
      var wait = 5_000L
      val http = Net.client.newBuilder().readTimeout(60, TimeUnit.SECONDS).build() // pings come every 25 s
      while (running) {
        try {
          val req = Request.Builder().url("${account.server}/api/v1/events")
            .header("authorization", "Bearer ${account.token}").header("origin", "nimbus://").header("accept", "text/event-stream").build()
          http.newCall(req).also { call = it }.execute().use { res ->
            if (res.code == 401) { running = false; return@use }
            if (!res.isSuccessful) throw IOException("events ${res.code}")
            wait = 5_000L
            Log.i("NimbusLive", "connected ${account.id}")
            // Anything that arrived while we weren't connected.
            check(Accounts.all(ctx).size)
            val src = res.body!!.source()
            var event = ""
            while (running) {
              val line = src.readUtf8Line() ?: break
              if (line.startsWith("event:")) event = line.substring(6).trim()
              else if (line.isEmpty()) { if (event == "notification") check(Accounts.all(ctx).size); event = "" }
            }
          }
        } catch (e: Exception) {
          if (running) Log.w("NimbusLive", "${account.id}: $e")
        }
        if (running) { pause(wait); wait = minOf(wait * 2, 300_000L) }
      }
    }
  }

  private val conns = HashMap<String, Conn>()
  private var watching: ConnectivityManager.NetworkCallback? = null

  private fun reconcile() = synchronized(conns) {
    val now = Accounts.all(this).associateBy { it.id }
    conns.entries.removeAll { (id, c) -> (now[id] != c.account).also { if (it) c.end() } }
    now.values.filter { it.id !in conns }.forEach { a -> conns[a.id] = Conn(applicationContext, a).also { it.start() } }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      ServiceCompat.startForeground(this, Live.ID, Live.notification(this), if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
    } catch (e: Exception) {
      Log.w("NimbusLive", "can't go foreground: $e")
      stopSelf()
      return START_NOT_STICKY
    }
    if (!Live.isOn(this) || Accounts.all(this).isEmpty()) { stopSelf(); return START_NOT_STICKY }
    reconcile()
    if (watching == null) {
      watching = object : ConnectivityManager.NetworkCallback() {
        // Back online: don't wait out the backoff.
        override fun onAvailable(network: Network) = synchronized(conns) { conns.values.forEach { it.kick() } }
      }.also { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(it) }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    watching?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
    synchronized(conns) { conns.values.forEach { it.end() }; conns.clear() }
  }

  override fun onBind(intent: Intent?): IBinder? = null
}

// Brings the connection back after a reboot or an app update.
class LiveBoot : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) = Live.sync(context)
}
