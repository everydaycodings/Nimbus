package org.nimbus.android

import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// "Save to device…": files and folders copied into a folder the person picked (an SD card, a USB drive, anywhere).
object Export {
  private fun prefs(c: Context) = c.getSharedPreferences("nimbus_export", Context.MODE_PRIVATE)

  // `items`: [{id, name, kind}]. The job outlives the app, so it waits in preferences for the worker.
  fun start(c: Context, accountId: String, treeUri: String, items: String) {
    val job = UUID.randomUUID().toString()
    prefs(c).edit().putString(job, JSONObject().put("accountId", accountId).put("treeUri", treeUri).put("items", JSONArray(items)).toString()).apply()
    val req = OneTimeWorkRequestBuilder<ExportWorker>()
      .setInputData(Data.Builder().putString("job", job).build())
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("export-$job", ExistingWorkPolicy.KEEP, req)
  }

  fun take(c: Context, job: String): JSONObject? = prefs(c).getString(job, null)?.let { JSONObject(it) }
  fun drop(c: Context, job: String) = prefs(c).edit().remove(job).apply()
}

class ExportWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val ctx = context.applicationContext

  override suspend fun getForegroundInfo() = info("Saving to your device", 0, 0)

  private fun info(title: String, done: Int, total: Int): ForegroundInfo {
    val n = Notify.progress(ctx, title, done.toLong(), total.toLong())
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(FolderSync.EXPORT_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(FolderSync.EXPORT_ID, n)
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    Notify.channels(ctx)
    val key = inputData.getString("job") ?: return@withContext Result.success()
    val job = Export.take(ctx, key) ?: return@withContext Result.success()
    val account = Accounts.get(ctx, job.getString("accountId"))
    if (account == null) {
      Export.drop(ctx, key)
      Notify.alert(ctx, "Couldn't save to your device", "Sign in to this account again.")
      return@withContext Result.success()
    }
    val tree = Uri.parse(job.getString("treeUri"))
    val items = job.getJSONArray("items")
    var saved = 0
    var failed = 0
    var firstError: String? = null
    fun miss(e: Exception) { failed++; if (firstError == null) firstError = e.message ?: "Something went wrong." }
    try {
      val dirs = HashMap<String, Uri>().apply { put("", Saf.root(tree)) }
      suspend fun save(id: String, version: String?, at: Uri, name: String) {
        val got = Fetch.toTemp(ctx, account, id, version) { isStopped }
        try {
          Fetch.into(ctx, got.file, Saf.create(ctx, at, name))
          saved++
        } catch (e: Halted) { throw e } catch (e: Exception) { miss(e) }
        try { setForeground(info("Saving to your device", saved + failed, 0)) } catch (_: Exception) {}
      }
      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        try {
          if (item.getString("kind") != "folder") save(item.getString("id"), null, dirs[""]!!, item.getString("name"))
          else {
            val top = Saf.mkdir(ctx, dirs[""]!!, item.getString("name"))
            val listing = Net.api(account, "GET", "/api/v1/tree?folder=${item.getString("id")}")
            val local = HashMap<String, Uri>().apply { put("", top) }
            val entries = listing.getJSONArray("entries")
            for (k in 0 until entries.length()) {
              val e = entries.getJSONObject(k)
              val path = e.getString("path")
              try {
                if (e.getString("kind") == "folder") Saf.ensureDir(ctx, local, path)
                else save(e.getString("id"), e.optString("versionId").ifEmpty { null }, Saf.ensureDir(ctx, local, path.substringBeforeLast('/', "")), path.substringAfterLast('/'))
              } catch (h: Halted) { throw h } catch (x: Exception) { miss(x) }
            }
          }
        } catch (h: Halted) {
          // Starting over would copy everything twice, so a stopped export is simply over.
          Export.drop(ctx, key)
          androidx.core.app.NotificationManagerCompat.from(ctx).cancel(FolderSync.EXPORT_ID)
          Notify.alert(ctx, "Saving to your device stopped", "$saved file${if (saved == 1) "" else "s"} were copied. Try again to save the rest.")
          return@withContext Result.success()
        } catch (x: Exception) { miss(x) }
      }
    } catch (x: Exception) {
      miss(x)
    }
    Export.drop(ctx, key)
    androidx.core.app.NotificationManagerCompat.from(ctx).cancel(FolderSync.EXPORT_ID)
    if (failed == 0) Notify.alert(ctx, "Saved to your device", "$saved file${if (saved == 1) "" else "s"} copied.")
    else Notify.alert(ctx, "Some files weren't saved", "$failed failed${firstError?.let { ": $it" } ?: ""}. $saved copied.")
    Result.success()
  }
}
