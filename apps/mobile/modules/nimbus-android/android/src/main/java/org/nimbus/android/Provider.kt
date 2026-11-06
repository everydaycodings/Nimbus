package org.nimbus.android

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.database.sqlite.SQLiteDatabase
import android.graphics.Point
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

// Whether the Files app may see Nimbus. JS sets these; see LockRule for the rule itself.
object AppLock {
  private fun prefs(c: Context) = c.getSharedPreferences("nimbus_lock", Context.MODE_PRIVATE)

  fun set(c: Context, unlockedAt: Long, timeout: Long?) {
    prefs(c).edit().putLong("unlockedAt", unlockedAt).putLong("timeout", timeout ?: -1L).putBoolean("locked", false).apply()
  }

  fun lockNow(c: Context) = prefs(c).edit().putBoolean("locked", true).apply()

  fun hidden(c: Context): Boolean {
    val p = prefs(c)
    val timeout = p.getLong("timeout", -1L).takeIf { it >= 0 }
    return LockRule.hidden(p.getBoolean("locked", false), p.getLong("unlockedAt", 0L), timeout, System.currentTimeMillis())
  }
}

// The copies JS keeps for offline use. JS owns this SQLite file; here it is only ever read.
object OfflineIndex {
  data class Copy(val id: String, val version: String?, val name: String, val mime: String?, val size: Long, val path: String, val parent: String?)

  private fun <T> query(c: Context, sql: String, args: Array<String>, row: (Cursor) -> T): List<T> {
    val file = File(c.filesDir, "SQLite/offline.db")
    if (!file.exists()) return emptyList()
    return try {
      val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
      try {
        db.rawQuery(sql, args).use { cur -> buildList { while (cur.moveToNext()) add(row(cur)) } }
      } finally { db.close() }
    } catch (e: Exception) {
      emptyList() // No table yet, or JS is mid-write: act as if nothing is offline.
    }
  }

  private const val COLS = "id, version, name, mime, size, path, parent"
  private fun toCopy(c: Cursor) = Copy(c.getString(0), c.getString(1), c.getString(2) ?: "", c.getString(3), c.getLong(4), c.getString(5), c.getString(6))

  fun find(c: Context, account: String, id: String) =
    query(c, "select $COLS from offline_files where account = ? and id = ?", arrayOf(account, id), ::toCopy).firstOrNull()

  // `parent` null means the account's top level.
  fun children(c: Context, account: String, parent: String?) =
    if (parent == null) query(c, "select $COLS from offline_files where account = ? and (parent is null or parent = 'root')", arrayOf(account), ::toCopy)
    else query(c, "select $COLS from offline_files where account = ? and parent = ?", arrayOf(account, parent), ::toCopy)
}

// The Files app's view of Nimbus: one root per account, listed live from /api/v1.
class NimbusDocumentsProvider : DocumentsProvider() {
  private data class Item(
    val id: String, val dir: Boolean, val name: String, val size: Long, val mime: String?,
    val version: String?, val thumb: Boolean, val modified: Long, val viewer: Boolean,
  )

  private class Found(val item: Item, val online: Boolean)

  private val ctx get() = context!!
  private val items = ConcurrentHashMap<String, Item>() // by document id; listings fill it, edits clear it
  private val emailAsked = ConcurrentHashMap.newKeySet<String>()
  private val listed = ConcurrentHashMap.newKeySet<String>() // folder documents someone has listed, for notifyChange

  override fun onCreate(): Boolean {
    instance = this
    return true
  }

  // ---- Reading ----

  override fun queryRoots(projection: Array<out String>?): Cursor {
    val out = MatrixCursor(cols(projection, ROOT_COLS))
    if (AppLock.hidden(ctx)) return out
    for (acc in Accounts.all(ctx)) {
      out.put(
        Root.COLUMN_ROOT_ID to acc.id,
        Root.COLUMN_FLAGS to Root.FLAG_SUPPORTS_CREATE,
        Root.COLUMN_TITLE to "Nimbus",
        Root.COLUMN_SUMMARY to summary(acc),
        Root.COLUMN_DOCUMENT_ID to DocIds.format(acc.id, DocIds.ROOT),
        Root.COLUMN_MIME_TYPES to "*/*",
        Root.COLUMN_ICON to ctx.applicationInfo.icon,
      )
    }
    return out
  }

  private fun prefs() = ctx.getSharedPreferences("nimbus_provider", Context.MODE_PRIVATE)

  // The account email once the server has told us; until then the server's host.
  private fun summary(acc: Accounts.Account): String {
    prefs().getString("email:${acc.id}", null)?.let { return it }
    if (emailAsked.add(acc.id)) Thread {
      try {
        val email = Net.api(acc, "GET", "/api/v1/me").getString("email")
        prefs().edit().putString("email:${acc.id}", email).apply()
        notifyRoots(ctx)
      } catch (_: Exception) {}
    }.start()
    return Uri.parse(acc.server).host ?: acc.server
  }

  override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor = read {
    guard()
    val id = parse(documentId)
    val out = MatrixCursor(cols(projection, DOC_COLS))
    if (id.item in DocIds.virtual) virtualRow(out, id)
    else addItem(out, id.account, (items[documentId] ?: resolve(account(id), id.item).item))
    out
  }

  override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor = read {
    guard()
    val id = parse(parentDocumentId)
    val acc = account(id)
    val out = MatrixCursor(cols(projection, DOC_COLS))
    out.setNotificationUri(ctx.contentResolver, DocumentsContract.buildChildDocumentsUri(authority(ctx), parentDocumentId))
    listed.add(parentDocumentId)
    val path = when (id.item) {
      DocIds.ROOT -> "/api/v1/files"
      DocIds.SHARED -> "/api/v1/shared"
      DocIds.STARRED -> "/api/v1/starred"
      DocIds.RECENT -> "/api/v1/recent"
      else -> "/api/v1/folders/${id.item}"
    }
    if (id.item == DocIds.ROOT) for (v in listOf(DocIds.SHARED, DocIds.STARRED, DocIds.RECENT)) virtualRow(out, DocIds.Id(acc.id, v))
    // Only real folders are parents; Shared, Starred and Recent just point at things elsewhere.
    val parent = if (id.item == DocIds.ROOT) "root" else if (id.item in DocIds.virtual) null else id.item
    val found = try {
      list(acc, path)
    } catch (e: IOException) {
      // No connection: the saved copies are all there is.
      OfflineIndex.children(ctx, acc.id, if (parent == "root") null else parent).map {
        Item(it.id, false, it.name, it.size, it.mime, it.version, false, 0L, false)
      }
    }
    val edit = prefs().edit()
    for (item in found) {
      items[DocIds.format(acc.id, item.id)] = item
      if (parent != null) edit.putString("p:${acc.id}:${item.id}", parent)
      addItem(out, acc.id, item)
    }
    edit.apply()
    out
  }

  // The server pages by offset: keep passing nextCursor back until it is null.
  private fun list(acc: Accounts.Account, path: String): List<Item> {
    val all = ArrayList<Item>()
    var cursor: String? = null
    repeat(100) {
      val q = path + "?limit=1000" + (cursor?.let { "&cursor=" + URLEncoder.encode(it, "UTF-8") } ?: "")
      val res = Net.api(acc, "GET", q)
      val arr = res.optJSONArray("items") ?: JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        if (o.isNull("trashedAt")) all.add(item(o))
      }
      cursor = if (res.isNull("nextCursor")) null else res.getString("nextCursor")
      if (cursor == null) return all
    }
    return all
  }

  private fun item(o: JSONObject): Item {
    fun str(k: String) = if (o.isNull(k)) null else o.getString(k)
    return Item(
      o.getString("id"), o.getString("kind") == "folder", o.getString("name"), o.optLong("size"), str("mime"),
      str("version"), !str("thumb").isNullOrEmpty(), date(o.optString("updatedAt")), str("role") == "viewer",
    )
  }

  // Server dates are ISO strings in UTC, like 2026-01-02T03:04:05.678Z.
  private fun date(iso: String): Long = try {
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.take(19))?.time ?: 0L
  } catch (_: Exception) { 0L }

  private fun addItem(out: MatrixCursor, account: String, it: Item) {
    var flags = 0
    if (!it.viewer) flags = flags or Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME or Document.FLAG_SUPPORTS_MOVE
    if (it.dir) { if (!it.viewer) flags = flags or Document.FLAG_DIR_SUPPORTS_CREATE }
    else {
      if (!it.viewer) flags = flags or Document.FLAG_SUPPORTS_WRITE
      if (it.thumb) flags = flags or Document.FLAG_SUPPORTS_THUMBNAIL
    }
    out.put(
      Document.COLUMN_DOCUMENT_ID to DocIds.format(account, it.id),
      Document.COLUMN_DISPLAY_NAME to it.name,
      Document.COLUMN_MIME_TYPE to if (it.dir) Document.MIME_TYPE_DIR else it.mime ?: "application/octet-stream",
      Document.COLUMN_FLAGS to flags,
      Document.COLUMN_SIZE to if (it.dir) null else it.size,
      Document.COLUMN_LAST_MODIFIED to if (it.modified > 0) it.modified else null,
    )
  }

  private fun virtualRow(out: MatrixCursor, id: DocIds.Id) {
    val name = when (id.item) {
      DocIds.ROOT -> "My files"
      DocIds.SHARED -> "Shared with me"
      DocIds.STARRED -> "Starred"
      else -> "Recent"
    }
    out.put(
      Document.COLUMN_DOCUMENT_ID to DocIds.format(id.account, id.item),
      Document.COLUMN_DISPLAY_NAME to name,
      Document.COLUMN_MIME_TYPE to Document.MIME_TYPE_DIR,
      Document.COLUMN_FLAGS to if (id.item == DocIds.ROOT) Document.FLAG_DIR_SUPPORTS_CREATE else 0,
    )
  }

  // ---- Opening ----

  override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor = read {
    guard()
    val id = parse(documentId)
    if (id.item in DocIds.virtual) throw FileNotFoundException(documentId)
    val acc = account(id)
    val found = resolve(acc, id.item)
    if (found.item.dir) throw FileNotFoundException("$documentId is a folder")
    if (mode.any { it == 'w' }) openForWrite(acc, found.item, mode)
    else ParcelFileDescriptor.open(localCopy(acc, found), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  // The bytes to read: the offline copy when it is the server's version (or we are offline), else a download.
  private fun localCopy(acc: Accounts.Account, found: Found): File {
    val item = found.item
    OfflineIndex.find(ctx, acc.id, item.id)?.let { c ->
      val file = File(c.path)
      if (file.exists() && (!found.online || c.version == item.version)) return file
    }
    val dir = File(ctx.cacheDir, "provider/${acc.id}").apply { mkdirs() }
    val dest = File(dir, "${item.id}-${item.version ?: "0"}")
    if (dest.exists() && dest.length() > 0) return dest
    if (!found.online) {
      dir.listFiles { f -> f.name.startsWith("${item.id}-") }?.firstOrNull()?.let { return it }
      throw FileNotFoundException("Not available offline")
    }
    fetchTo(acc, "/api/files/${item.id}/download" + (item.version?.let { "?v=$it" } ?: ""), dest)
    dir.listFiles { f -> f.name.startsWith("${item.id}-") && f != dest }?.forEach { it.delete() }
    return dest
  }

  private fun fetchTo(acc: Accounts.Account, path: String, dest: File) {
    val req = Request.Builder().url(acc.server + path)
      .header("authorization", "Bearer ${acc.token}")
      .header("origin", "nimbus://")
      .build()
    Net.client.newCall(req).execute().use { res ->
      if (res.code == 404) throw FileNotFoundException(path)
      if (!res.isSuccessful) throw IOException("The server answered ${res.code}")
      dest.parentFile?.mkdirs()
      val part = File(dest.path + ".part")
      res.body!!.byteStream().use { input -> part.outputStream().use { input.copyTo(it, 1 shl 16) } }
      if (!part.renameTo(dest)) throw IOException("Couldn't save the download")
    }
  }

  // Edits go to a temp copy; closing it queues the upload as a new version of this file.
  private fun openForWrite(acc: Accounts.Account, item: Item, mode: String): ParcelFileDescriptor {
    if (item.viewer) throw SecurityException("You can only view this file.")
    val parent = parentOf(acc, item.id) ?: throw FileNotFoundException("Open this file's folder in Files first, so Nimbus knows where it lives.")
    val tmp = File(File(ctx.filesDir, "shared").apply { mkdirs() }, UUID.randomUUID().toString()) // Share.forget removes it after the upload
    // parseMode truncates for "w" and "wt"; every other mode starts from the current bytes.
    val truncates = mode.contains('t') || mode == "w"
    if (truncates) tmp.createNewFile() else localCopy(acc, resolve(acc, item.id)).copyTo(tmp, overwrite = true)
    val startLen = tmp.length()
    val startTime = tmp.lastModified()
    return ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.parseMode(mode), Handler(Looper.getMainLooper())) { error ->
      if (error != null || (!truncates && tmp.length() == startLen && tmp.lastModified() == startTime)) {
        tmp.delete() // failed, or opened and closed without a change
      } else Thread { queueSave(acc, item, parent, tmp) }.start()
    }
  }

  private fun queueSave(acc: Accounts.Account, item: Item, parent: String, tmp: File) {
    val job = JSONObject()
      .put("accountId", acc.id).put("server", acc.server).put("tusUrl", tusUrl(acc))
      .put("uri", Uri.fromFile(tmp).toString()).put("name", item.name).put("size", tmp.length())
      .put("mime", item.mime ?: "application/octet-stream").put("path", item.name)
      .put("planToken", "") // planned when it sends, which may be after the phone is back online
      .put("parentId", if (parent == "root") JSONObject.NULL else parent)
      .put("onConflict", "version").put("wifiOnly", false).put("baseNode", item.id)
    item.version?.let { job.put("baseVersion", it) }
    Store.of(ctx).add(JSONArray().put(job))
    items.remove(DocIds.format(acc.id, item.id))
    Uploads.schedule(ctx)
    Uploads.publish()
  }

  private fun tusUrl(acc: Accounts.Account): String {
    val key = "tus:${acc.id}"
    try {
      prefs().edit().putString(key, Net.api(acc, "GET", "/api/v1/instance").getString("tusUrl")).apply()
    } catch (_: Exception) {}
    return prefs().getString(key, null) ?: (acc.server.trimEnd('/') + "/files/")
  }

  override fun openDocumentThumbnail(documentId: String, sizeHint: Point, signal: CancellationSignal?): AssetFileDescriptor = read {
    guard()
    val id = parse(documentId)
    val acc = account(id)
    val item = items[documentId] ?: resolve(acc, id.item).item
    val dest = File(ctx.cacheDir, "provider/thumbs/${item.id}-${item.version ?: "0"}")
    if (!dest.exists()) fetchTo(acc, "/api/files/${item.id}/thumb" + (item.version?.let { "?v=$it" } ?: ""), dest)
    AssetFileDescriptor(ParcelFileDescriptor.open(dest, ParcelFileDescriptor.MODE_READ_ONLY), 0, dest.length())
  }

  // ---- Changing things ----

  override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String = write {
    guard()
    val parent = parse(parentDocumentId)
    if (parent.item in DocIds.virtual && parent.item != DocIds.ROOT) throw UnsupportedOperationException("Create files in My files or a folder.")
    val acc = account(parent)
    val parentId: Any = if (parent.item == DocIds.ROOT) JSONObject.NULL else parent.item
    val newId = if (mimeType == Document.MIME_TYPE_DIR) {
      Net.api(acc, "POST", "/api/v1/folders", JSONObject().put("parentId", parentId).put("name", displayName)).getString("id")
    } else newEmptyFile(acc, parentId, displayName, mimeType)
    prefs().edit().putString("p:${acc.id}:$newId", if (parent.item == DocIds.ROOT) "root" else parent.item).apply()
    notifyChildren(parentDocumentId)
    DocIds.format(acc.id, newId)
  }

  // There is no "new empty file" route, so this runs a zero-byte upload to completion right here.
  private fun newEmptyFile(acc: Accounts.Account, parentId: Any, name: String, mime: String): String {
    val plan = Net.api(acc, "POST", "/api/v1/uploads/plan", JSONObject().put("parentId", parentId)
      .put("entries", JSONArray().put(JSONObject().put("path", name).put("size", 0))))
    plan.optString("error").takeIf { it.isNotEmpty() }?.let { throw Refused(400, it) }
    plan.optJSONArray("rejected")?.optJSONObject(0)?.let { throw Refused(400, it.optString("reason")) }
    val url = Tus.create(tusUrl(acc), 0, mapOf("filename" to name, "filetype" to mime, "token" to plan.getString("token"), "path" to name, "onConflict" to "rename"))
    val done = Net.api(acc, "POST", "/api/v1/uploads/finish", JSONObject().put("uploadUrl", url).put("sha256", EMPTY_SHA))
    return done.optString("nodeId").ifEmpty { throw IllegalStateException("The server didn't create the file.") }
  }

  override fun renameDocument(documentId: String, displayName: String): String? = write {
    guard()
    val id = parse(documentId)
    Net.api(account(id), "PATCH", "/api/v1/items/${id.item}", JSONObject().put("name", displayName))
    filesChanged(id.account) // the parent's list shows the new name
    null // The id does not change.
  }

  // Always to Trash: this provider has no permanent delete.
  override fun deleteDocument(documentId: String) = write {
    guard()
    val id = parse(documentId)
    Net.api(account(id), "POST", "/api/v1/items/trash", JSONObject().put("ids", JSONArray().put(id.item)))
    filesChanged(id.account)
    Unit
  }

  override fun moveDocument(sourceDocumentId: String, sourceParentDocumentId: String, targetParentDocumentId: String): String = write {
    guard()
    val src = parse(sourceDocumentId)
    val target = parse(targetParentDocumentId)
    if (src.account != target.account) throw UnsupportedOperationException("Files can't move between accounts.")
    if (target.item in DocIds.virtual && target.item != DocIds.ROOT) throw UnsupportedOperationException("Move into My files or a folder.")
    val into: Any = if (target.item == DocIds.ROOT) JSONObject.NULL else target.item
    Net.api(account(src), "POST", "/api/v1/items/move", JSONObject().put("ids", JSONArray().put(src.item)).put("parentId", into))
    prefs().edit().putString("p:${src.account}:${src.item}", if (target.item == DocIds.ROOT) "root" else target.item).apply()
    notifyChildren(sourceParentDocumentId)
    notifyChildren(targetParentDocumentId)
    sourceDocumentId
  }

  // ---- Helpers ----

  private fun cols(asked: Array<out String>?, all: Array<String>): Array<String> = asked?.let { arrayOf(*it) } ?: all

  // One row, in whatever columns the caller asked for.
  private fun MatrixCursor.put(vararg values: Pair<String, Any?>) {
    val byName = values.toMap()
    val row = newRow()
    for (c in columnNames) row.add(byName[c])
  }

  private fun guard() {
    if (AppLock.hidden(ctx)) throw SecurityException("Nimbus is locked. Open the app to unlock it.")
  }

  private fun parse(doc: String) = DocIds.parse(doc) ?: throw FileNotFoundException(doc)
  private fun account(id: DocIds.Id) = Accounts.get(ctx, id.account) ?: throw FileNotFoundException("That Nimbus account is signed out.")

  // "root" means the account's top level; null means not known yet.
  private fun parentOf(acc: Accounts.Account, itemId: String): String? =
    prefs().getString("p:${acc.id}:$itemId", null) ?: OfflineIndex.find(ctx, acc.id, itemId)?.parent?.ifEmpty { "root" }

  // The server's view of one item, or what we kept of it when there is no connection.
  private fun resolve(acc: Accounts.Account, itemId: String): Found {
    val doc = DocIds.format(acc.id, itemId)
    try {
      val res = Net.api(acc, "GET", "/api/v1/items/$itemId")
      val o = res.optJSONObject("item") ?: throw FileNotFoundException(doc)
      // Not sent by the server yet; used when it is (see the report).
      res.optJSONObject("details")?.takeIf { it.has("parentId") }?.let { d ->
        prefs().edit().putString("p:${acc.id}:$itemId", if (d.isNull("parentId")) "root" else d.getString("parentId")).apply()
      }
      return Found(item(o).also { items[doc] = it }, true)
    } catch (e: Refused) {
      throw FileNotFoundException(e.message)
    } catch (e: FileNotFoundException) {
      throw e
    } catch (_: IOException) {}
    val kept = items[doc] ?: OfflineIndex.find(ctx, acc.id, itemId)?.let {
      Item(it.id, false, it.name, it.size, it.mime, it.version, false, 0L, false)
    } ?: throw FileNotFoundException("Not available offline")
    return Found(kept, false)
  }

  private fun notifyChildren(doc: String) =
    ctx.contentResolver.notifyChange(DocumentsContract.buildChildDocumentsUri(authority(ctx), doc), null)

  // Reads fail as "not found"; the Files app shows that as an unavailable file instead of crashing.
  private fun <T> read(body: () -> T): T = try {
    body()
  } catch (e: FileNotFoundException) { throw e } catch (e: SecurityException) { throw e }
  catch (e: Exception) { throw FileNotFoundException(e.message ?: "Couldn't reach Nimbus") }

  // Writes use exceptions Android can pass back to the caller.
  private fun <T> write(body: () -> T): T = try {
    body()
  } catch (e: UnsupportedOperationException) { throw e } catch (e: SecurityException) { throw e }
  catch (e: Exception) { throw IllegalStateException(if (e is IOException && e !is FileNotFoundException) "No connection to Nimbus." else e.message ?: "Nimbus refused this.") }

  companion object {
    private const val EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    private val ROOT_COLS = arrayOf(Root.COLUMN_ROOT_ID, Root.COLUMN_FLAGS, Root.COLUMN_TITLE, Root.COLUMN_SUMMARY, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_MIME_TYPES, Root.COLUMN_ICON)
    private val DOC_COLS = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED)

    // Must match the provider's authority in AndroidManifest.xml.
    fun authority(c: Context) = c.packageName + ".documents"

    fun notifyRoots(c: Context) = c.contentResolver.notifyChange(DocumentsContract.buildRootsUri(authority(c)), null)

    fun uri(c: Context, accountId: String, itemId: String): String? =
      if (Accounts.get(c, accountId) == null) null
      else DocumentsContract.buildDocumentUri(authority(c), DocIds.format(accountId, itemId)).toString()
  }

  // JS calls this when something changed on the server (a refresh, an upload finishing).
  fun filesChanged(accountId: String) {
    items.keys.removeAll { it.startsWith("$accountId:") }
    for (doc in listed) if (doc.startsWith("$accountId:")) notifyChildren(doc)
  }

}

@Volatile private var instance: NimbusDocumentsProvider? = null

// For the module: tell open Files screens to reload.
fun notifyFilesChanged(c: Context, accountId: String) {
  instance?.filesChanged(accountId)
  NimbusDocumentsProvider.notifyRoots(c)
}
