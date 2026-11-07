package org.nimbus.android

import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID

// The phone's side of a sync: folders reached through Android's folder picker (a "tree" URI the person granted).
object Saf {
  data class Entry(val path: String, val uri: Uri, val size: Long, val mtime: Long, val dir: Boolean)

  fun root(tree: Uri): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

  fun mimeOf(name: String) = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"

  // Every file and folder below the tree, with `/` paths. Dot names (.thumbnails, .trashed-…) are left alone.
  // Throws when the folder can't be read, so an unplugged card never looks like an emptied folder.
  fun list(ctx: Context, tree: Uri): List<Entry> {
    if (stat(ctx, root(tree)) == null) throw IOException("The folder is gone")
    val out = ArrayList<Entry>()
    fun walk(docId: String, prefix: String, depth: Int) {
      if (depth > 30) return
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
      val cols = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      )
      val cursor = ctx.contentResolver.query(children, cols, null, null, null) ?: throw IOException("Couldn't read the folder")
      val rows = cursor.use { c -> buildList { while (c.moveToNext()) add(arrayOf(c.getString(0), c.getString(1), c.getString(2), c.getLong(3).toString(), c.getLong(4).toString())) } }
      for (r in rows) {
        val name = r[1] ?: continue
        if (name.startsWith('.')) continue
        val dir = r[2] == DocumentsContract.Document.MIME_TYPE_DIR
        val path = prefix + name
        out += Entry(path, DocumentsContract.buildDocumentUriUsingTree(tree, r[0]), r[3].toLong(), r[4].toLong(), dir)
        if (dir) walk(r[0], "$path/", depth + 1)
      }
    }
    walk(DocumentsContract.getTreeDocumentId(tree), "", 0)
    return out
  }

  // Size and modified time, or null when the document isn't there.
  fun stat(ctx: Context, uri: Uri): Pair<Long, Long>? {
    val cols = arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
    return ctx.contentResolver.query(uri, cols, null, null, null)?.use { if (it.moveToFirst()) it.getLong(0) to it.getLong(1) else null }
  }

  fun mkdir(ctx: Context, parent: Uri, name: String): Uri =
    DocumentsContract.createDocument(ctx.contentResolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, name) ?: throw IOException("Couldn't make the folder “$name”")

  fun create(ctx: Context, parent: Uri, name: String): Uri =
    DocumentsContract.createDocument(ctx.contentResolver, parent, mimeOf(name), name) ?: throw IOException("Couldn't make “$name”")

  fun delete(ctx: Context, uri: Uri) {
    if (!DocumentsContract.deleteDocument(ctx.contentResolver, uri)) throw IOException("Couldn't remove it from the phone")
  }

  // Folders for a `/` path under the tree, made as needed. `dirs` remembers them (the root is "").
  fun ensureDir(ctx: Context, dirs: MutableMap<String, Uri>, path: String): Uri {
    dirs[path]?.let { return it }
    val parent = ensureDir(ctx, dirs, path.substringBeforeLast('/', ""))
    return mkdir(ctx, parent, path.substringAfterLast('/')).also { dirs[path] = it }
  }
}

// A server file saved to a temp file in full, so a dropped connection never leaves half a file on the phone.
object Fetch {
  class Result(val file: File, val sha: String)

  fun toTemp(ctx: Context, account: Accounts.Account, id: String, version: String?, stopped: () -> Boolean): Result {
    val req = Request.Builder().url("${account.server}/api/files/$id/download" + (version?.let { "?v=$it" } ?: ""))
      .header("authorization", "Bearer ${account.token}").header("origin", "nimbus://").build()
    val dir = File(ctx.cacheDir, "foldersync").apply { mkdirs() }
    val tmp = File(dir, UUID.randomUUID().toString())
    try {
      val digest = MessageDigest.getInstance("SHA-256")
      Net.client.newCall(req).execute().use { res ->
        if (res.code == 404) throw FileNotFoundException("It is no longer on the server.")
        if (!res.isSuccessful) throw IOException("The server answered ${res.code}")
        val buf = ByteArray(1 shl 16)
        res.body!!.byteStream().use { input ->
          tmp.outputStream().use { out ->
            while (true) {
              if (stopped()) throw Halted()
              val n = input.read(buf)
              if (n < 0) break
              digest.update(buf, 0, n)
              out.write(buf, 0, n)
            }
          }
        }
      }
      return Result(tmp, digest.digest().joinToString("") { "%02x".format(it) })
    } catch (e: Exception) {
      tmp.delete()
      throw e
    }
  }

  // Copies the temp file into a document (new, or overwriting), then deletes it.
  fun into(ctx: Context, from: File, uri: Uri) {
    try {
      (ctx.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("Couldn't write to the phone")).use { out -> from.inputStream().use { it.copyTo(out, 1 shl 16) } }
    } finally {
      from.delete()
    }
  }
}

private val gate = Mutex() // two runs never work on the same pair at once

// Runs every un-paused pair (or the one named) once.
class FolderSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val ctx = context.applicationContext
  private val d = FolderSync.db(ctx)
  private val store = Store.of(ctx)

  override suspend fun getForegroundInfo(): ForegroundInfo = info("Syncing folders", 0, 0)

  private fun info(title: String, done: Int, total: Int): ForegroundInfo {
    val n = Notify.progress(ctx, title, done.toLong(), total.toLong())
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(FolderSync.SYNC_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(FolderSync.SYNC_ID, n)
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) { gate.withLock { pass() } }

  private suspend fun pass(): Result {
    Notify.channels(ctx)
    val only = inputData.getString("pair")
    val force = inputData.getBoolean("force", false)
    val pairs = (if (only != null) d.pairs("id = ?", arrayOf(only)) else d.pairs()).filter { !it.paused }
    if (pairs.isEmpty()) return Result.success()
    val rules = FolderSync.rules(ctx)
    if (rules.optBoolean("chargingOnly") && !Backup.charging(ctx)) {
      pairs.forEach { d.state(it.id, "waiting", "Waiting to charge") }
      FolderSync.waitFor(ctx, wifi = false)
      return Result.success()
    }
    if (!rules.optBoolean("mobileData") && Uploads.metered(ctx)) {
      pairs.forEach { d.state(it.id, "waiting", "Waiting for Wi-Fi") }
      FolderSync.waitFor(ctx, wifi = true)
      return Result.success()
    }
    val sender = Sender(ctx) { isStopped }
    var again = false
    try {
      for (p in pairs) {
        if (isStopped) return Result.retry()
        if (sync(p, sender, rules, force)) again = true
      }
    } finally {
      androidx.core.app.NotificationManagerCompat.from(ctx).cancel(FolderSync.SYNC_ID)
    }
    return if (again) Result.retry() else Result.success()
  }

  private class Remote(val id: String, val stamp: String, val versionId: String?)

  private class Job(val path: String, val target: String, val entry: Saf.Entry, val sha: String, val onConflict: String, val conflict: Boolean)

  private fun device(): String =
    Settings.Global.getString(ctx.contentResolver, "device_name")?.takeIf { it.isNotBlank() } ?: Build.MODEL

  private fun column(uploadId: String, name: String): String? =
    store.readableDatabase.rawQuery("select $name from uploads where id = ?", arrayOf(uploadId)).use { if (it.moveToFirst()) it.getString(0) else null }

  // Returns true when this pair should be tried again soon (offline, rate limited, cut off).
  private suspend fun sync(p: FolderSync.Db.Link, sender: Sender, rules: JSONObject, force: Boolean): Boolean {
    fun stop(reason: String, alert: String? = null): Boolean {
      d.state(p.id, "failing", reason)
      if (alert != null) Notify.alert(ctx, alert, "Open Nimbus to fix it.")
      return false
    }
    val account = Accounts.get(ctx, p.account) ?: return stop("Sign in to this account again")
    val tree = Uri.parse(p.treeUri)
    if (ctx.contentResolver.persistedUriPermissions.none { it.uri == tree && it.isReadPermission && it.isWritePermission })
      return stop("Nimbus lost access to this folder. Remove it and add it again.")
    d.state(p.id, "running", null, 0, 0)
    d.clearFailed(p.id)
    store.delete("source = 'sync' and media_id = ?", arrayOf(p.id))
    val reliable = rules.optBoolean("reliable")
    val wifiOnly = !rules.optBoolean("mobileData")
    var done = 0
    var total = 0
    var up = 0; var down = 0; var removed = 0; var conflicts = 0

    suspend fun tick() {
      d.state(p.id, "running", null, done, total)
      if (reliable) try { setForeground(info("Syncing ${p.name}: ${minOf(total, done + 1)} of $total", done, total)) } catch (_: Exception) {}
    }

    try {
      val files = try {
        Saf.list(ctx, tree)
      } catch (_: Exception) {
        return stop("Nimbus can't read the phone folder. Is the card in?")
      }
      val dirs = HashMap<String, Uri>().apply { put("", Saf.root(tree)); files.filter { it.dir }.forEach { put(it.path, it.uri) } }
      val onPhone = files.filter { !it.dir }.associateBy { it.path }

      val listing = try {
        Net.api(account, "GET", "/api/v1/tree" + (p.remoteId?.let { "?folder=$it" } ?: ""))
      } catch (e: Refused) {
        if (e.status == 404) return stop("The folder in Nimbus is gone. Remove this one and add it again.")
        throw e
      }
      if (listing.optBoolean("truncated")) return stop("The folder in Nimbus has more than 50,000 items. Pick a smaller one.")
      val remote = HashMap<String, Remote>()
      listing.getJSONArray("entries").let { a ->
        for (i in 0 until a.length()) {
          val e = a.getJSONObject(i)
          if (e.getString("kind") != "file") continue
          val sha = e.optString("sha256").ifEmpty { null }
          val version = e.optString("versionId").ifEmpty { null }
          remote[e.getString("path")] = Remote(e.getString("id"), sha ?: "v:$version", version)
        }
      }

      val base = d.base(p.id)
      // A phone file whose size and time haven't moved is the one last synced; only the rest is read.
      // ponytail: a provider that reports no modified time means reading every file each run.
      val stamps = HashMap<String, String>()
      val skip = HashSet<String>()
      for ((path, e) in onPhone) {
        if (isStopped) return true
        val b = base[path]
        if (b != null && !b.broken && e.mtime > 0 && b.size == e.size && b.mtime == e.mtime) stamps[path] = b.sha
        else try {
          stamps[path] = sender.hash(e.uri, null)
        } catch (_: Halted) {
          return true
        } catch (_: Exception) {
          // Left out of this run entirely: a file we couldn't read must not look deleted.
          skip += path
          d.fail(p.id, path, "Couldn't read this file on the phone.")
        }
      }
      val baseSha = base.filterKeys { it !in skip }.mapValues { it.value.sha }
      val broken = base.filterValues { it.broken }.keys
      var plan = SyncRules.plan(stamps, remote.filterKeys { it !in skip }.mapValues { it.value.stamp }, baseSha, p.twoWay, device(), broken)

      // Backup only: a file the server has under this path or anywhere in My files is already safe.
      val have = HashMap<String, String?>() // path -> node id
      if (!p.twoWay) {
        val ups = plan.filter { it.kind == SyncRules.Kind.UPLOAD }
        for (a in ups) if (remote[a.path]?.stamp == stamps[a.path]) have[a.path] = remote[a.path]!!.id
        val ask = ups.filter { it.path !in have }
        for (batch in ask.chunked(200)) {
          val items = JSONArray().apply { batch.forEach { put(JSONObject().put("sha256", stamps[it.path])) } }
          val matches = Net.api(account, "POST", "/api/v1/uploads/exists", JSONObject().put("items", items)).getJSONArray("matches")
          batch.forEachIndexed { i, a -> matches.optJSONObject(i)?.takeIf { it.optString("by") == "sha256" }?.let { have[a.path] = it.optString("id") } }
        }
        plan = plan.map { if (it.path in have) SyncRules.Action(it.path, SyncRules.Kind.ADOPT) else it }
      }

      if (p.twoWay && !force && SyncRules.massDelete(plan, base.size)) {
        val n = plan.count { it.kind == SyncRules.Kind.DELETE_LOCAL || it.kind == SyncRules.Kind.DELETE_REMOTE }
        d.state(p.id, "held", "$n deletions are waiting. Check them, then tap Sync now to go ahead.")
        Notify.alert(ctx, "Folder sync is waiting", "${p.name}: $n deletions need your OK.")
        return false
      }

      total = plan.count { it.kind != SyncRules.Kind.ADOPT && it.kind != SyncRules.Kind.FORGET }
      tick()
      // `fresh`: the file was just written here, so its size and time now are what to remember. Otherwise the
      // ones from the listing, so a change made while it uploaded still reads as a change next time.
      fun record(path: String, sha: String, e: Saf.Entry, node: String?, fresh: Boolean) {
        val s = if (fresh) Saf.stat(ctx, e.uri) else null
        d.put(p.id, path, FolderSync.Db.Base(sha, s?.first ?: e.size, s?.second ?: e.mtime, node, false))
      }

      for (a in plan) when (a.kind) {
        SyncRules.Kind.ADOPT -> record(a.path, stamps[a.path]!!, onPhone[a.path]!!, have[a.path] ?: remote[a.path]?.id, fresh = false)
        SyncRules.Kind.FORGET -> d.forget(p.id, a.path)
        else -> {}
      }

      // Deletes, always to the server's Trash; the phone's go only for files whose bytes the server still holds.
      val trash = plan.filter { it.kind == SyncRules.Kind.DELETE_REMOTE }
      for (batch in trash.chunked(100)) {
        if (isStopped) return true
        try {
          Net.api(account, "POST", "/api/v1/items/trash", JSONObject().put("ids", JSONArray(batch.map { remote[it.path]!!.id })))
          batch.forEach { d.forget(p.id, it.path) }
          removed += batch.size
        } catch (e: Refused) {
          if (e.status == 401 || e.status == 429 || e.status >= 500) throw e
          batch.forEach { d.fail(p.id, it.path, e.message ?: "The server wouldn't move this to Trash.") }
        }
        done += batch.size
        tick()
      }
      for (a in plan.filter { it.kind == SyncRules.Kind.DELETE_LOCAL }) {
        if (isStopped) return true
        try {
          Saf.delete(ctx, onPhone[a.path]!!.uri)
          d.forget(p.id, a.path)
          removed++
        } catch (e: Exception) {
          d.fail(p.id, a.path, e.message ?: "Couldn't remove this from the phone.")
        }
        done++
        tick()
      }

      // Uploads: new files, changed files (a new version), and the phone's side of a conflict (beside the server's).
      val jobs = plan.mapNotNull { a ->
        val e = onPhone[a.path] ?: return@mapNotNull null
        when (a.kind) {
          SyncRules.Kind.UPLOAD -> Job(a.path, a.path, e, stamps[a.path]!!, if (p.twoWay && remote.containsKey(a.path)) "version" else "rename", false)
          SyncRules.Kind.CONFLICT -> Job(a.path, a.conflictPath!!, e, stamps[a.path]!!, "rename", true)
          else -> null
        }
      }
      val landed = HashSet<String>() // conflicts whose phone copy is safely on the server
      if (jobs.isNotEmpty()) {
        val instance = Net.api(account, "GET", "/api/v1/instance")
        val me = Net.api(account, "GET", "/api/v1/me")
        val cap = if (me.isNull("uploadSpeedBytes")) null else me.optLong("uploadSpeedBytes").takeIf { it > 0 }
        for (batch in jobs.chunked(100)) {
          val entries = JSONArray().apply { batch.forEach { put(JSONObject().put("path", it.target).put("size", it.entry.size)) } }
          val plan2 = Net.api(account, "POST", "/api/v1/uploads/plan", JSONObject().put("parentId", p.remoteId ?: JSONObject.NULL).put("entries", entries))
          plan2.optString("error").takeIf { it.isNotEmpty() }?.let {
            return if (it.contains("space", true)) stop(it, "Folder sync stopped: storage is full") else stop(it)
          }
          val rejected = plan2.optJSONArray("rejected")?.let { r -> (0 until r.length()).associate { r.getJSONObject(it).getString("path") to r.getJSONObject(it).getString("reason") } } ?: emptyMap()
          val queued = HashMap<String, Job>()
          for (j in batch) {
            val why = rejected[j.target]
            if (why != null) { d.fail(p.id, j.path, why); done++; continue }
            val id = store.addSync(account, instance.getString("tusUrl"), j.entry.uri.toString(), j.target.substringAfterLast('/'), j.entry.size, Saf.mimeOf(j.target),
              j.target, p.remoteId, plan2.getString("token"), j.onConflict, wifiOnly, cap, j.sha, p.id)
            queued[id] = j
          }
          val metered = Uploads.metered(ctx)
          while (!isStopped) {
            val row = store.claim(metered, "sync") ?: break
            val j = queued[row.id] ?: continue
            when (sender.send(row)) {
              Sender.Outcome.DONE -> {
                if (j.conflict) { landed += j.path; conflicts++ } else {
                  record(j.path, j.sha, j.entry, column(row.id, "node_id"), fresh = false)
                  up++
                }
                store.delete("id = ?", arrayOf(row.id))
              }
              Sender.Outcome.FAILED -> {
                d.fail(p.id, j.path, column(row.id, "error") ?: "The upload failed.")
                store.delete("id = ?", arrayOf(row.id))
              }
              Sender.Outcome.AUTH -> return stop("Sign in to this account again", "Folder sync stopped: sign in again")
              Sender.Outcome.FULL -> return stop("Your Nimbus storage is full", "Folder sync stopped: storage is full")
              Sender.Outcome.OFFLINE, Sender.Outcome.HALTED -> { d.state(p.id, "waiting", "Waiting for a connection"); return true }
            }
            done++
            tick()
          }
          if (isStopped) return true
        }
      }

      // Downloads: new and changed server files, and the server's copy over the phone's after a conflict.
      val fetches = plan.filter { it.kind == SyncRules.Kind.DOWNLOAD || (it.kind == SyncRules.Kind.CONFLICT && it.path in landed) }
      for (a in fetches) {
        if (isStopped) return true
        val r = remote[a.path]!!
        try {
          val got = Fetch.toTemp(ctx, account, r.id, r.versionId) { isStopped }
          if (r.stamp.length == 64 && got.sha != r.stamp) {
            got.file.delete()
            throw IOException("The download didn't match the server's copy.")
          }
          val existing = onPhone[a.path]
          // Marked first: a write cut short leaves a file that must be replaced, never uploaded.
          d.put(p.id, a.path, FolderSync.Db.Base("", 0, 0, r.id, true))
          val uri = existing?.uri ?: Saf.create(ctx, Saf.ensureDir(ctx, dirs, a.path.substringBeforeLast('/', "")), a.path.substringAfterLast('/'))
          Fetch.into(ctx, got.file, uri)
          record(a.path, got.sha, Saf.Entry(a.path, uri, 0, 0, false), r.id, fresh = true)
          if (a.kind == SyncRules.Kind.DOWNLOAD) down++
        } catch (_: Halted) {
          return true
        } catch (e: FileNotFoundException) {
          d.fail(p.id, a.path, e.message ?: "It is no longer on the server.")
        } catch (e: java.io.IOException) {
          d.fail(p.id, a.path, e.message ?: "Couldn't save this to the phone.")
        } catch (e: SecurityException) {
          d.fail(p.id, a.path, "Nimbus can no longer write to this folder.")
        }
        done++
        tick()
      }
      d.finished(p.id, up, down, removed, conflicts)
      return false
    } catch (e: Refused) {
      return when (e.status) {
        401 -> { stop("Sign in to this account again", "Folder sync stopped: sign in again"); false }
        429 -> { d.state(p.id, "waiting", "The server is busy, trying again shortly"); true }
        else -> { d.state(p.id, "failing", e.message); e.status >= 500 }
      }
    } catch (_: IOException) {
      d.state(p.id, "waiting", "Waiting for a connection")
      return true
    }
  }
}
