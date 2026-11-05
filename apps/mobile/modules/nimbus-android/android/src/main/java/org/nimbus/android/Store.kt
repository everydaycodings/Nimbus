package org.nimbus.android

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// The upload queue. It outlives the app, so a killed or rebooted phone carries on where it stopped.
class Store private constructor(context: Context) : SQLiteOpenHelper(context, "nimbus-uploads.db", null, 2) {
  override fun onCreate(db: SQLiteDatabase) {
    media(db)
    db.execSQL(
      """create table uploads (
        id text primary key, account text not null, server text not null, tus_url text not null,
        uri text not null, name text not null, size integer not null, mime text not null, path text not null,
        plan_token text not null, planned integer not null, parent_id text, on_conflict text not null,
        wifi_only integer not null, speed_cap integer, source text not null, media_id text,
        status text not null, sent integer not null default 0, upload_url text, sha text,
        node_id text, version_id text, dup_id text, dup_path text, error text, created integer not null)"""
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
    if (old < 2) media(db)
  }

  // What camera backup has done with each photo, per account: queued, done, skipped (already on the
  // server), failed or freed (removed from the phone after backup).
  private fun media(db: SQLiteDatabase) = db.execSQL(
    """create table backup_media (
      media_id text not null, account text not null, state text not null, name text not null,
      size integer not null, taken integer not null, sha text, upload_id text, node_id text, error text,
      primary key (media_id, account))"""
  )

  data class Row(
    val id: String, val account: String, val server: String, val tusUrl: String, val uri: String,
    val name: String, val size: Long, val mime: String, val path: String, val planToken: String,
    val planned: Long, val parentId: String?, val onConflict: String, val wifiOnly: Boolean,
    val speedCap: Long?, val source: String, val mediaId: String?, val status: String, val sent: Long,
    val uploadUrl: String?, val sha: String?,
  )

  private fun Cursor.str(c: String) = getColumnIndexOrThrow(c).let { if (isNull(it)) null else getString(it) }
  private fun Cursor.long(c: String) = getColumnIndexOrThrow(c).let { if (isNull(it)) null else getLong(it) }

  private fun Cursor.row() = Row(
    str("id")!!, str("account")!!, str("server")!!, str("tus_url")!!, str("uri")!!, str("name")!!, long("size")!!,
    str("mime")!!, str("path")!!, str("plan_token")!!, long("planned")!!, str("parent_id"), str("on_conflict")!!,
    long("wifi_only") == 1L, long("speed_cap"), str("source")!!, str("media_id"), str("status")!!, long("sent")!!,
    str("upload_url"), str("sha"),
  )

  fun add(jobs: JSONArray, source: String = "manual"): Int {
    val now = System.currentTimeMillis()
    writableDatabase.transaction {
      for (i in 0 until jobs.length()) {
        val j = jobs.getJSONObject(i)
        insert("uploads", null, ContentValues().apply {
          put("id", UUID.randomUUID().toString())
          put("account", j.getString("accountId")); put("server", j.getString("server")); put("tus_url", j.getString("tusUrl"))
          put("uri", j.getString("uri")); put("name", j.getString("name")); put("size", j.getLong("size"))
          put("mime", j.optString("mime")); put("path", j.getString("path")); put("plan_token", j.getString("planToken"))
          put("planned", now); put("parent_id", if (j.isNull("parentId")) null else j.getString("parentId"))
          put("on_conflict", j.getString("onConflict")); put("wifi_only", if (j.optBoolean("wifiOnly")) 1 else 0)
          if (!j.isNull("speedCap") && j.has("speedCap")) put("speed_cap", j.getLong("speedCap"))
          put("source", source); put("media_id", j.optString("mediaId").ifEmpty { null })
          put("status", "queued"); put("created", now)
        })
      }
    }
    return jobs.length()
  }

  private inline fun SQLiteDatabase.transaction(body: SQLiteDatabase.() -> Unit) {
    beginTransaction()
    try { body(); setTransactionSuccessful() } finally { endTransaction() }
  }

  fun get(id: String): Row? = readableDatabase.query("uploads", null, "id = ?", arrayOf(id), null, null, null).use { if (it.moveToFirst()) it.row() else null }

  fun rowsWhere(where: String, args: Array<String>): List<Row> =
    readableDatabase.query("uploads", null, where, args, null, null, null).use { c -> buildList { while (c.moveToNext()) add(c.row()) } }

  fun status(id: String) = readableDatabase.rawQuery("select status from uploads where id = ?", arrayOf(id)).use { if (it.moveToFirst()) it.getString(0) else null }

  // One at a time across the worker's parallel lanes: marks the next sendable row as uploading.
  @Synchronized
  fun claim(metered: Boolean, source: String): Row? {
    val where = (if (metered) "status = 'queued' and wifi_only = 0" else "status in ('queued', 'waiting')") + " and source = ?"
    val row = readableDatabase.query("uploads", null, where, arrayOf(source), null, null, "created, rowid", "1").use { if (it.moveToFirst()) it.row() else null } ?: return null
    set(row.id, "status" to "uploading", "error" to null)
    return row
  }

  // While metered, rows that must wait for Wi-Fi say so; back on Wi-Fi they go back in the queue.
  fun markWaiting(metered: Boolean) {
    if (metered) writableDatabase.execSQL("update uploads set status = 'waiting' where status = 'queued' and wifi_only = 1")
    else writableDatabase.execSQL("update uploads set status = 'queued' where status = 'waiting'")
  }

  fun pending(source: String) = readableDatabase.rawQuery("select count(*) from uploads where status in ('queued', 'waiting', 'uploading') and source = ?", arrayOf(source)).use { it.moveToFirst(); it.getInt(0) }

  // Only a worker sets "uploading", and one runs per source, so at its start any left over were cut off.
  fun recover(source: String) = writableDatabase.execSQL("update uploads set status = 'queued' where status = 'uploading' and source = ?", arrayOf(source))

  // ---- Camera backup ----

  fun addBackup(account: Accounts.Account, tusUrl: String, item: Media.Item, path: String, token: String, wifiOnly: Boolean, cap: Long?, sha: String): String {
    val id = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    writableDatabase.insert("uploads", null, ContentValues().apply {
      put("id", id); put("account", account.id); put("server", account.server); put("tus_url", tusUrl)
      put("uri", item.uri.toString()); put("name", item.name); put("size", item.size); put("mime", item.mime)
      put("path", path); put("plan_token", token); put("planned", now); putNull("parent_id")
      // Backup never makes a version: a same-named file is kept beside it.
      put("on_conflict", "rename"); put("wifi_only", if (wifiOnly) 1 else 0); cap?.let { put("speed_cap", it) }
      put("source", "backup"); put("media_id", item.id); put("status", "queued"); put("sha", sha); put("created", now)
    })
    return id
  }

  fun setMedia(mediaId: String, account: String, state: String, item: Media.Item, sha: String? = null, uploadId: String? = null, error: String? = null) {
    writableDatabase.insertWithOnConflict("backup_media", null, ContentValues().apply {
      put("media_id", mediaId); put("account", account); put("state", state); put("name", item.name)
      put("size", item.size); put("taken", item.taken); put("sha", sha); put("upload_id", uploadId); put("error", error)
    }, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun mediaDone(uploadId: String) {
    writableDatabase.execSQL("update backup_media set state = 'done', error = null, node_id = (select node_id from uploads where id = ?) where upload_id = ?", arrayOf(uploadId, uploadId))
    writableDatabase.delete("uploads", "id = ?", arrayOf(uploadId))
  }

  fun mediaFailed(uploadId: String) {
    writableDatabase.execSQL("update backup_media set state = 'failed', error = (select error from uploads where id = ?) where upload_id = ?", arrayOf(uploadId, uploadId))
    writableDatabase.delete("uploads", "id = ?", arrayOf(uploadId))
  }

  // Everything already looked at; failed items come back only through Retry.
  fun trackedMedia(account: String): Set<String> =
    readableDatabase.rawQuery("select media_id from backup_media where account = ?", arrayOf(account)).use { c -> buildSet { while (c.moveToNext()) add(c.getString(0)) } }

  fun failedMedia(account: String): List<Triple<String, String, String>> =
    readableDatabase.rawQuery("select media_id, name, coalesce(error, '') from backup_media where account = ? and state = 'failed' order by taken desc", arrayOf(account))
      .use { c -> buildList { while (c.moveToNext()) add(Triple(c.getString(0), c.getString(1), c.getString(2))) } }

  fun retryMedia() = writableDatabase.delete("backup_media", "state = 'failed'", null)

  // Backed up or already there: either way the server has the bytes, so the phone's copy may go.
  fun doneMedia(account: String): List<Pair<String, String>> =
    readableDatabase.rawQuery("select media_id, sha from backup_media where account = ? and state in ('done', 'skipped') and sha is not null", arrayOf(account))
      .use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }

  fun freed(ids: List<String>) = writableDatabase.transaction {
    ids.forEach { execSQL("update backup_media set state = 'freed' where media_id = ?", arrayOf(it)) }
  }

  fun backupPending(account: String) = readableDatabase.rawQuery("select count(*) from uploads where source = 'backup' and account = ? and status in ('queued', 'waiting', 'uploading')", arrayOf(account)).use { it.moveToFirst(); it.getInt(0) }

  fun recoverBackup() = recover("backup")

  // Backup turned off: its queue goes, and the media it held are looked at afresh next time.
  fun dropBackupUploads() {
    writableDatabase.execSQL("delete from backup_media where state = 'queued'")
    writableDatabase.delete("uploads", "source = 'backup'", null)
  }

  fun clearMedia() {
    writableDatabase.delete("backup_media", null, null)
    writableDatabase.delete("uploads", "source = 'backup'", null)
  }

  fun set(id: String, vararg values: Pair<String, Any?>) {
    val cv = ContentValues()
    for ((k, v) in values) when (v) {
      null -> cv.putNull(k)
      is String -> cv.put(k, v)
      is Long -> cv.put(k, v)
      is Int -> cv.put(k, v)
      is Boolean -> cv.put(k, if (v) 1 else 0)
    }
    writableDatabase.update("uploads", cv, "id = ?", arrayOf(id))
  }

  fun setStatus(where: String, args: Array<String>, status: String) = writableDatabase.update("uploads", ContentValues().apply { put("status", status); putNull("error") }, where, args)

  fun delete(where: String, args: Array<String>) = writableDatabase.delete("uploads", where, args)

  fun urls(where: String, args: Array<String>): List<String> =
    readableDatabase.rawQuery("select upload_url from uploads where upload_url is not null and status != 'done' and $where", args).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  // What the app shows: the JS UploadRow shape.
  fun rows(): JSONArray {
    val out = JSONArray()
    readableDatabase.rawQuery("select * from uploads where source = 'manual' order by created, rowid", null).use { c ->
      while (c.moveToNext()) {
        val status = c.str("status")!!
        out.put(JSONObject().apply {
          put("id", c.str("id")); put("accountId", c.str("account")); put("name", c.str("name")); put("mime", c.str("mime"))
          put("size", c.long("size")); put("sent", c.long("sent"))
          // "waiting" is also how the JS strip says Wi-Fi; a row held for any other reason is still just queued.
          put("status", status)
          c.str("error")?.let { put("error", it) }
          c.str("node_id")?.let { put("nodeId", it) }
          if (c.str("on_conflict") == "version") put("asVersion", true)
          c.str("dup_id")?.let { put("duplicateOf", JSONObject().put("id", it).put("path", c.str("dup_path"))) }
        })
      }
    }
    return out
  }

  fun counts(): Triple<Int, Int, Int> = readableDatabase.rawQuery(
    "select count(*), sum(status = 'done'), sum(status = 'failed') from uploads where source = 'manual' and status != 'refused'", null
  ).use { it.moveToFirst(); Triple(it.getInt(0), it.getInt(1), it.getInt(2)) }

  fun progress(): Pair<Long, Long> = readableDatabase.rawQuery(
    "select sum(size), sum(case when status = 'done' then size else sent end) from uploads where source = 'manual' and status not in ('failed', 'refused')", null
  ).use { it.moveToFirst(); it.getLong(0) to it.getLong(1) }

  companion object {
    @Volatile private var instance: Store? = null
    fun of(context: Context) = instance ?: synchronized(this) { instance ?: Store(context.applicationContext).also { instance = it } }
  }
}
