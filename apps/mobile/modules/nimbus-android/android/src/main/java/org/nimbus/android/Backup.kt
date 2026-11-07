package org.nimbus.android

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.provider.MediaStore
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Camera backup: settings and status live here, the work in BackupWorker.
object Backup {
  private const val PREFS = "nimbus_backup"
  const val PHOTOS = "photos"
  @Volatile var listener: (() -> Unit)? = null

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun settings(context: Context) = JSONObject(prefs(context).getString("settings", null) ?: "{}")

  fun save(context: Context, json: String) {
    val before = settings(context)
    val next = JSONObject(json)
    prefs(context).edit().putString("settings", json).apply()
    BackupTile.refresh(context)
    // A new account or a start date further back means everything is looked at again.
    if (before.optString("accountId") != next.optString("accountId")) Store.of(context).clearMedia()
    if (next.optBoolean("enabled") && next.optBoolean("paused")) {
      schedule(context)
      // The file sending now stops at once; the run sees the flag and ends.
      Store.of(context).rowsWhere("source = 'backup' and status = 'uploading'", arrayOf()).forEach { Uploads.halted.add(it.id) }
      pause(context)
    } else if (next.optBoolean("enabled")) {
      if (prefs(context).getString("state", null) == "paused") keepCounts(context, "idle")
      schedule(context)
      runNow(context)
    } else {
      cancel(context)
      setStatus(context, "off")
    }
  }

  fun setStatus(context: Context, state: String, reason: String? = null, done: Int = 0, total: Int = 0, finished: Boolean = false) {
    val p = prefs(context)
    val edit = p.edit()
      .putString("state", state).putString("reason", reason)
      .putInt("done", done).putInt("total", total)
    if (finished) edit.putLong("lastAt", System.currentTimeMillis())
    edit.apply()
    listener?.invoke()
  }

  fun paused(context: Context) = settings(context).optBoolean("paused")

  private fun keepCounts(context: Context, state: String, reason: String? = null) =
    prefs(context).let { setStatus(context, state, reason, it.getInt("done", 0), it.getInt("total", 0)) }

  fun pause(context: Context) = keepCounts(context, "paused")

  // A file resumed on its own: a run already going picks it up, otherwise start one.
  fun resumed(context: Context) {
    if (prefs(context).getString("state", null) != "running") runNow(context)
  }

  // What backup would still look at: camera and chosen albums, from the start date, not yet tracked.
  fun fresh(context: Context, account: String): List<Media.Item> {
    val s = settings(context)
    val albums = s.optJSONArray("albums")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
    val from = s.optLong("from")
    val tracked = Store.of(context).trackedMedia(account)
    return Media.all(context).filter { (it.camera || it.bucketId in albums) && it.taken >= from && it.id !in tracked }.sortedBy { it.taken }
  }

  const val NO_ACCESS = "Nimbus can't see your photos"

  fun status(context: Context): String {
    val p = prefs(context)
    val s = settings(context)
    val enabled = s.optBoolean("enabled")
    val account = s.optString("accountId")
    val access = Media.access(context)
    // Photo access came back (say, from Settings): don't keep showing the old failure until the next 15-minute run.
    if (enabled && access != "none" && p.getString("reason", null) == NO_ACCESS) {
      setStatus(context, "idle", null)
      runNow(context)
    }
    val failed = JSONArray()
    val skipped = JSONArray()
    if (enabled) for ((id, name, error) in Store.of(context).failedMedia(account))
      failed.put(JSONObject().put("mediaId", id).put("name", name).put("error", error))
    if (enabled) for ((id, name) in Store.of(context).skippedMedia(account))
      skipped.put(JSONObject().put("mediaId", id).put("name", name))
    return JSONObject()
      .put("state", if (enabled) p.getString("state", "idle") else "off")
      .put("reason", p.getString("reason", null) ?: JSONObject.NULL)
      .put("done", p.getInt("done", 0)).put("total", p.getInt("total", 0))
      .apply { if (p.contains("lastAt")) put("lastAt", p.getLong("lastAt", 0)) }
      .put("failed", failed)
      .put("skipped", skipped)
      .put("access", access)
      .toString()
  }

  // Every 15 minutes, which is as often as Android allows, plus straight away when a photo arrives.
  fun schedule(context: Context) {
    val wm = WorkManager.getInstance(context)
    val periodic = PeriodicWorkRequestBuilder<BackupWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    wm.enqueueUniquePeriodicWork("backup", ExistingPeriodicWorkPolicy.UPDATE, periodic)
    watchForPhotos(context)
  }

  // A content trigger fires once, so each photo-triggered run sets the next one up behind itself.
  fun watchForPhotos(context: Context, again: Boolean = false) {
    val req = OneTimeWorkRequestBuilder<BackupWorker>()
      .addTag(PHOTOS)
      .setConstraints(
        Constraints.Builder()
          .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
          .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
          .setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
          .build()
      )
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("backup-photos", if (again) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP, req)
  }

  fun runNow(context: Context) {
    val req = OneTimeWorkRequestBuilder<BackupWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("backup-now", ExistingWorkPolicy.REPLACE, req)
  }

  // Waiting for Wi-Fi or a charger: a job that starts when it comes. Appended, not kept: the run that
  // calls this may itself be that job (Wi-Fi came back but wasn't the active network yet), and KEEP would
  // then drop the new wait and leave backup waiting with nothing to wake it.
  fun waitFor(context: Context, wifi: Boolean) {
    val c = Constraints.Builder()
    if (wifi) c.setRequiredNetworkType(NetworkType.UNMETERED) else c.setRequiresCharging(true).setRequiredNetworkType(NetworkType.CONNECTED)
    val req = OneTimeWorkRequestBuilder<BackupWorker>().setConstraints(c.build()).build()
    WorkManager.getInstance(context).enqueueUniqueWork(if (wifi) "backup-wifi" else "backup-charging", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
  }

  fun cancel(context: Context) {
    val wm = WorkManager.getInstance(context)
    listOf("backup", "backup-photos", "backup-now", "backup-wifi", "backup-charging").forEach { wm.cancelUniqueWork(it) }
    Store.of(context).dropBackupUploads()
  }

  fun charging(context: Context): Boolean {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
  }

  // Month folders by path, found by walking the folder picker, so it works on older servers too.
  class Folders(private val account: Accounts.Account) {
    private val cache = HashMap<String, String?>()
    fun id(path: String): String? {
      var parent: String? = null
      var prefix = ""
      for (name in path.split('/')) {
        prefix = if (prefix.isEmpty()) name else "$prefix/$name"
        val p = parent
        val found = cache.getOrPut(prefix) {
          val list = Net.api(account, "GET", "/api/v1/picker" + (p?.let { "?parent=$it" } ?: "")).getJSONArray("folders")
          (0 until list.length()).map { list.getJSONObject(it) }.firstOrNull { it.getString("name").equals(name, ignoreCase = true) }?.getString("id")
        }
        parent = found ?: return null
      }
      return parent
    }
  }

  // Backed-up items older than `days` that are still on the phone and that the server confirms by hash.
  fun freeable(context: Context, days: Int): List<Media.Item> {
    val s = settings(context)
    val account = Accounts.get(context, s.optString("accountId")) ?: throw Refused(401, "Sign in to the backup account again first.")
    val cutoff = if (days == 0) Long.MAX_VALUE else System.currentTimeMillis() - days * 86_400_000L
    val done = Store.of(context).doneMedia(account.id)
    val onPhone = Media.all(context).associateBy { it.id }
    val candidates = done.mapNotNull { (id, sha) -> onPhone[id]?.takeIf { it.taken < cutoff }?.let { it to sha } }
    val out = ArrayList<Media.Item>()
    for (batch in candidates.chunked(200)) {
      val items = JSONArray().apply { batch.forEach { put(JSONObject().put("sha256", it.second)) } }
      val matches = Net.api(account, "POST", "/api/v1/uploads/exists", JSONObject().put("items", items)).getJSONArray("matches")
      batch.forEachIndexed { i, (item, _) ->
        val m = matches.optJSONObject(i)
        if (m != null && m.optString("by") == "sha256") out += item
      }
    }
    return out
  }
}

class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val ctx = context.applicationContext
  private val store = Store.of(ctx)

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val n = Notify.progress(ctx, "Backing up photos", 0, 0)
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(Notify.BACKUP_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(Notify.BACKUP_ID, n)
  }

  private suspend fun progress(done: Int, total: Int, reliable: Boolean) {
    Backup.setStatus(ctx, "running", null, done, total)
    if (!reliable) return
    val n = Notify.progress(ctx, "Backing up ${minOf(total, done + 1)} of $total", done.toLong(), total.toLong())
    val info = if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(Notify.BACKUP_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(Notify.BACKUP_ID, n)
    // Android can refuse a foreground service from the background; backup carries on without it.
    try { setForeground(info) } catch (_: Exception) {}
  }

  // Backup's jobs (every 15 minutes, new photo, now, Wi-Fi, charger) can start together. One at a time:
  // a pass begins by re-queueing uploads that look cut off, which would steal one another run is sending.
  override suspend fun doWork(): Result = one.withLock { pass(first = true) }

  companion object {
    private val one = Mutex()
  }

  private suspend fun pass(first: Boolean): Result {
    if (first && Backup.PHOTOS in tags) runCatching { Backup.watchForPhotos(ctx, again = true) }
    Notify.channels(ctx)
    val s = Backup.settings(ctx)
    if (!s.optBoolean("enabled")) return Result.success()
    val account = Accounts.get(ctx, s.optString("accountId")) ?: run {
      Backup.setStatus(ctx, "failing", "Sign in to the backup account again")
      return Result.success()
    }
    if (Backup.paused(ctx)) {
      Backup.pause(ctx)
      return Result.success()
    }
    if (Media.access(ctx) == "none") {
      Backup.setStatus(ctx, "failing", Backup.NO_ACCESS)
      return Result.success()
    }
    val mobileData = s.optBoolean("mobileData")
    if (s.optBoolean("chargingOnly") && !Backup.charging(ctx)) {
      Backup.setStatus(ctx, "waiting", "Waiting to charge")
      Backup.waitFor(ctx, wifi = false)
      return Result.success()
    }
    if (!mobileData && Uploads.metered(ctx)) {
      Backup.setStatus(ctx, "waiting", "Waiting for Wi-Fi")
      Backup.waitFor(ctx, wifi = true)
      return Result.success()
    }
    val reliable = s.optBoolean("reliable")
    val sender = Sender(ctx) { isStopped }
    val videosOnWifi = s.optBoolean("videosWifiOnly", true)

    try {
      store.recoverBackup()
      val fresh = Backup.fresh(ctx, account.id)
      val folders = Backup.Folders(account)
      val instance = Net.api(account, "GET", "/api/v1/instance")
      val me = Net.api(account, "GET", "/api/v1/me")
      val cap = if (me.isNull("uploadSpeedBytes")) null else me.optLong("uploadSpeedBytes").takeIf { it > 0 }
      var total = fresh.size + store.backupPending(account.id)
      var done = 0
      progress(done, total, reliable)

      // A failure that's about the account, not one file: say so once and stop.
      fun stop(reason: String, alert: String): Result {
        Backup.setStatus(ctx, "failing", reason)
        Notify.alert(ctx, alert, "Open Nimbus to fix it.")
        return Result.success()
      }

      fun paused(): Result {
        Backup.pause(ctx)
        return Result.success()
      }

      // Sends what's queued. Null: carry on; otherwise the run ends with that result.
      suspend fun drain(): Result? {
        val metered = Uploads.metered(ctx)
        while (!isStopped && !Backup.paused(ctx)) {
          if (s.optBoolean("chargingOnly") && !Backup.charging(ctx)) break
          val row = store.claim(metered, "backup") ?: break
          when (sender.send(row)) {
            Sender.Outcome.DONE -> store.mediaDone(row.id)
            Sender.Outcome.FAILED -> store.mediaFailed(row.id)
            Sender.Outcome.AUTH -> return stop("Sign in to the backup account again", "Backup stopped: sign in again")
            Sender.Outcome.FULL -> return stop("Your Nimbus storage is full", "Backup stopped: storage is full")
            Sender.Outcome.OFFLINE -> return Result.retry()
            Sender.Outcome.HALTED -> {
              if (isStopped) return Result.retry()
              if (Backup.paused(ctx)) return paused()
              // That one file was paused or skipped; carry on with the rest.
              total--
              progress(done, total, reliable)
              continue
            }
          }
          done++
          progress(done, total, reliable)
        }
        return null
      }

      for (all in fresh.chunked(100)) {
        if (isStopped) return Result.retry()
        if (Backup.paused(ctx)) return paused()
        // Skipped from the queue screen since this run listed them.
        val tracked = store.trackedMedia(account.id)
        val batch = all.filter { it.id !in tracked }
        // Hash first: the server matches on the bytes, wherever they are.
        val hashed = batch.mapNotNull { item ->
          try { item to sender.hash(item.uri, null) } catch (e: Exception) {
            store.setMedia(item.id, account.id, "failed", item, error = "Couldn't read this file on the phone.")
            done++
            null
          }
        }
        val paths = hashed.map { (item, _) -> Rules.folderFor(item.taken, if (item.camera) null else item.bucket) }
        val query = JSONArray()
        hashed.forEachIndexed { i, (item, sha) ->
          val q = JSONObject().put("sha256", sha)
          // Only a month folder that exists can hold a same-named file.
          folders.id(paths[i])?.let { q.put("name", item.name).put("size", item.size).put("parentId", it) }
          query.put(q)
        }
        val matches = if (hashed.isEmpty()) JSONArray() else Net.api(account, "POST", "/api/v1/uploads/exists", JSONObject().put("items", query)).getJSONArray("matches")
        val send = ArrayList<Triple<Media.Item, String, String>>()
        hashed.forEachIndexed { i, (item, sha) ->
          val m = matches.optJSONObject(i)?.let { Rules.Match(it.optString("by"), it.optBoolean("sameSize")) }
          if (Rules.decide(m) == Rules.Decision.SKIP) {
            store.setMedia(item.id, account.id, "skipped", item, sha = sha)
            done++
          } else send += Triple(item, sha, "${paths[i]}/${item.name}")
        }
        if (send.isNotEmpty()) {
          val entries = JSONArray().apply { send.forEach { put(JSONObject().put("path", it.third).put("size", it.first.size)) } }
          val plan = Net.api(account, "POST", "/api/v1/uploads/plan", JSONObject().put("parentId", JSONObject.NULL).put("entries", entries))
          plan.optString("error").takeIf { it.isNotEmpty() }?.let { return if (it.contains("space", true)) stop(it, "Backup stopped: storage is full") else stop(it, "Backup stopped") }
          val rejected = plan.optJSONArray("rejected")?.let { r -> (0 until r.length()).associate { r.getJSONObject(it).getString("path") to r.getJSONObject(it).getString("reason") } } ?: emptyMap()
          for ((item, sha, path) in send) {
            val reason = rejected[path]
            if (reason != null) {
              store.setMedia(item.id, account.id, "failed", item, error = reason)
              done++
              continue
            }
            val wifiOnly = !mobileData || (videosOnWifi && item.mime.startsWith("video/"))
            val uploadId = store.addBackup(account, instance.getString("tusUrl"), item, path, plan.getString("token"), wifiOnly, cap, sha)
            store.setMedia(item.id, account.id, "queued", item, sha = sha, uploadId = uploadId)
          }
        }
        // Send what's queued before looking at the next batch, so progress starts early.
        drain()?.let { return it }
      }
      // And what an earlier run left queued (resumed, or held for Wi-Fi) when no new photos came.
      drain()?.let { return it }
      // Photos taken (or copied in) while this run went fire no trigger: the next one is only armed after this
      // run ends. Look again and go round while there are new ones, so "All backed up" is true when it shows.
      if (Backup.paused(ctx)) return paused()
      if (!isStopped && Backup.fresh(ctx, account.id).isNotEmpty()) return pass(first = false)
      // Anything still queued here is a video waiting for Wi-Fi.
      if (store.backupPending(account.id) > 0) {
        Backup.setStatus(ctx, "waiting", "Videos are waiting for Wi-Fi", done, total)
        Backup.waitFor(ctx, wifi = true)
      } else if (store.backupPausedItems(account.id) > 0) {
        val n = store.backupPausedItems(account.id)
        Backup.setStatus(ctx, "waiting", "$n paused item${if (n == 1) "" else "s"}", done, total)
      } else Backup.setStatus(ctx, "idle", null, done, total, finished = true)
      return Result.success()
    } catch (e: Refused) {
      return if (e.status == 401) {
        Backup.setStatus(ctx, "failing", "Sign in to the backup account again")
        Notify.alert(ctx, "Backup stopped: sign in again", "Open Nimbus to fix it.")
        Result.success()
      } else if (e.status == 429) {
        // Rate limited: routine, and over within a minute. Not a failure to alarm anyone with.
        Backup.setStatus(ctx, "waiting", "The server is busy, trying again shortly")
        Result.retry()
      } else {
        Backup.setStatus(ctx, "failing", e.message)
        Result.retry()
      }
    } catch (_: java.io.IOException) {
      Backup.setStatus(ctx, "waiting", "Waiting for a connection")
      return Result.retry()
    } finally {
      androidx.core.app.NotificationManagerCompat.from(ctx).cancel(Notify.BACKUP_ID)
    }
  }
}
