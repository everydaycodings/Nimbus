package org.nimbus.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class NimbusAndroidModule : Module() {
  private val context get() = appContext.reactContext!!.applicationContext
  private val store get() = Store.of(context)
  private var freeing: Pair<Promise, List<String>>? = null

  private fun changed() = Uploads.publish()

  override fun definition() = ModuleDefinition {
    Name("NimbusAndroid")
    Events("uploads", "share", "backup")

    OnCreate {
      Uploads.listener = { sendEvent("uploads", mapOf("json" to store.rows().toString())) }
      Backup.listener = { sendEvent("backup", mapOf<String, Any>()) }
      // Anything left from before the app was closed carries on.
      if (store.pending("manual") > 0) Uploads.schedule(context)
      // Opening the app also looks for new photos, in case Android has held the background job back.
      if (Backup.settings(context).optBoolean("enabled")) {
        Backup.schedule(context)
        Backup.runNow(context)
      }
      // Opened by a share from another app.
      Share.take(appContext.currentActivity?.intent)
    }
    OnDestroy {
      Uploads.listener = null
      Backup.listener = null
    }
    OnNewIntent { intent -> if (Share.take(intent)) sendEvent("share", mapOf<String, Any>()) }

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        Scan.REQUEST -> Scan.result(payload.resultCode, payload.data)
        FREE_UP -> freeing?.let { (promise, ids) ->
          freeing = null
          if (payload.resultCode == Activity.RESULT_OK) {
            store.freed(ids)
            promise.resolve(ids.size)
          } else promise.resolve(0)
        }
      }
    }

    Function("setAccounts") { json: String ->
      Accounts.save(context, json)
      NimbusDocumentsProvider.notifyRoots(context)
    }

    // The Files app hides Nimbus when the app lock is on and the last unlock is older than the timeout.
    Function("setUnlockedAt") { ms: Double, timeoutMs: Double? ->
      AppLock.set(context, ms.toLong(), timeoutMs?.toLong())
      NimbusDocumentsProvider.notifyRoots(context)
    }
    Function("lockNow") {
      AppLock.lockNow(context)
      NimbusDocumentsProvider.notifyRoots(context)
    }
    Function("documentUri") { accountId: String, itemId: String -> NimbusDocumentsProvider.uri(context, accountId, itemId) }
    // Open with: another app gets the provider URI with read and write grants, so its saves come back as versions.
    Function("viewDocument") { accountId: String, itemId: String, mime: String ->
      val uri = NimbusDocumentsProvider.uri(context, accountId, itemId)?.takeIf { !AppLock.hidden(context) }?.let { Uri.parse(it) }
      if (uri == null) false else try {
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime.ifEmpty { "*/*" })
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        view.clipData = ClipData.newRawUri("", uri) // lets the chooser pass the grants on
        val chooser = Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (appContext.currentActivity ?: context).startActivity(chooser)
        true
      } catch (_: ActivityNotFoundException) { false }
    }
    Function("notifyFilesChanged") { accountId: String -> notifyFilesChanged(context, accountId) }

    // Off the JS thread: a shared file Android won't let us keep is copied first.
    AsyncFunction("addUploads") { json: String ->
      val jobs = JSONArray(json)
      for (i in 0 until jobs.length()) {
        val job = jobs.getJSONObject(i)
        job.put("uri", Share.keep(context, job.getString("uri")))
      }
      store.add(jobs)
      Uploads.schedule(context)
      changed()
    }

    Function("uploads") { store.rows().toString() }

    Function("pauseUpload") { id: String ->
      Uploads.halted.add(id)
      store.setStatus("id = ? and status in ('queued', 'waiting', 'uploading')", arrayOf(id), "paused")
      changed()
    }
    Function("resumeUpload") { id: String ->
      Uploads.halted.remove(id)
      store.setStatus("id = ? and status = 'paused'", arrayOf(id), "queued")
      Uploads.schedule(context)
      changed()
    }
    Function("retryUpload") { id: String ->
      Uploads.halted.remove(id)
      store.setStatus("id = ? and status = 'failed'", arrayOf(id), "queued")
      Uploads.schedule(context)
      changed()
    }
    Function("cancelUpload") { id: String -> cancel("id = ?", arrayOf(id)) }
    Function("dropUpload") { id: String ->
      store.delete("id = ?", arrayOf(id))
      changed()
    }
    // "Same as…" rows wait for Keep or Remove unless the person clears everything.
    Function("clearUploads") { accountId: String, everything: Boolean ->
      store.delete("account = ? and source = 'manual' and status = 'done'" + if (everything) "" else " and dup_id is null", arrayOf(accountId))
      changed()
    }
    Function("cancelAccount") { accountId: String -> cancel("account = ? and source = 'manual'", arrayOf(accountId)) }

    AsyncFunction("sharedFiles") {
      Share.take(appContext.currentActivity?.intent)
      Share.files(context)
    }

    AsyncFunction("scanAvailable") { Scan.available(context) }
    AsyncFunction("scan") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.resolve(null)
      Scan.start(activity, promise)
    }

    // The photo picker hides real names ("1000000021.mp4"); with photo access the library has them.
    Function("mediaName") { assetId: String -> Media.name(context, assetId) }

    Function("backupSettings") { Backup.settings(context).toString() }
    Function("setBackup") { json: String -> Backup.save(context, json) }
    AsyncFunction("backupStatus") { Backup.status(context) }
    AsyncFunction("backupAlbums") { Media.albums(context) }
    Function("retryBackup") {
      store.retryMedia()
      Backup.runNow(context)
    }

    AsyncFunction("freeUpCandidates") { days: Int ->
      val items = Backup.freeable(context, days)
      JSONObject().put("count", items.size).put("bytes", items.sumOf { it.size }).toString()
    }
    // Android shows its own confirmation; nothing goes without it.
    AsyncFunction("freeUp") { days: Int, promise: Promise ->
      if (Build.VERSION.SDK_INT < 30) return@AsyncFunction promise.reject(CodedException("Free up space needs Android 11 or later."))
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.resolve(0)
      val items = Backup.freeable(context, days)
      if (items.isEmpty()) return@AsyncFunction promise.resolve(0)
      val request = MediaStore.createDeleteRequest(context.contentResolver, items.map { Media.uriOf(it.id) })
      freeing = promise to items.map { it.id }
      activity.startIntentSenderForResult(request.intentSender, FREE_UP, null, 0, 0, 0)
    }
  }

  // Stops it, forgets it, and tells the server to drop what it had.
  private fun cancel(where: String, args: Array<String>) {
    val urls = store.urls(where, args)
    store.rowsWhere(where, args).forEach {
      Uploads.halted.add(it.id)
      Uploads.release(context, it.uri)
    }
    store.delete(where, args)
    changed()
    if (urls.isNotEmpty()) Thread { urls.forEach(Tus::delete) }.start()
  }

  companion object {
    const val FREE_UP = 4104
  }
}
