package org.nimbus.android

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.provider.DocumentsContract
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

// Folder backup and two-way sync: pairs of (phone folder, folder in My files). Settings and state live here,
// the work in FolderSyncWorker. Camera backup's rules (Wi-Fi, charging, reliable) are kept apart in `rules`.
object FolderSync {
  const val SYNC_ID = 4150
  const val EXPORT_ID = 4151
  private const val PREFS = "nimbus_foldersync"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun rules(c: Context) = JSONObject(prefs(c).getString("rules", null) ?: "{}")
  fun setRules(c: Context, json: String) {
    prefs(c).edit().putString("rules", json).apply()
    runNow(c)
  }

  fun changed() = Backup.listener?.invoke() // the app's "backup" event also refreshes the folder sync screen

  // ---- Pairs ----

  class Db private constructor(context: Context) : SQLiteOpenHelper(context, "nimbus-foldersync.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL(
        """create table pairs (
          id text primary key, account text not null, name text not null, tree_uri text not null, folder_name text not null,
          remote_id text, remote_path text not null, two_way integer not null, paused integer not null default 0,
          created integer not null, state text not null default 'idle', reason text, last_at integer,
          up integer not null default 0, down integer not null default 0, removed integer not null default 0,
          conflicts integer not null default 0, done integer not null default 0, total integer not null default 0)"""
      )
      // What both sides held at the last sync. size and mtime let an unchanged phone file skip hashing.
      db.execSQL(
        """create table files (
          pair text not null, path text not null, sha text not null, size integer not null, mtime integer not null,
          node_id text, broken integer not null default 0, primary key (pair, path))"""
      )
      db.execSQL("create table failed (pair text not null, path text not null, error text not null, at integer not null, primary key (pair, path))")
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {}

    data class Link(val id: String, val account: String, val name: String, val treeUri: String, val remoteId: String?, val twoWay: Boolean, val paused: Boolean)
    data class Base(val sha: String, val size: Long, val mtime: Long, val nodeId: String?, val broken: Boolean)

    fun pairs(where: String = "1", args: Array<String> = emptyArray()): List<Link> =
      readableDatabase.rawQuery("select id, account, name, tree_uri, remote_id, two_way, paused from pairs where $where order by created", args).use { c ->
        buildList { while (c.moveToNext()) add(Link(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getInt(5) == 1, c.getInt(6) == 1)) }
      }

    fun json(): JSONArray {
      val out = JSONArray()
      readableDatabase.rawQuery(
        """select id, account, name, folder_name, remote_path, two_way, paused, state, reason, last_at, up, down, removed, conflicts, done, total,
          (select count(*) from failed f where f.pair = pairs.id) from pairs order by created""", null
      ).use { c ->
        while (c.moveToNext()) out.put(JSONObject()
          .put("id", c.getString(0)).put("accountId", c.getString(1)).put("name", c.getString(2)).put("folderName", c.getString(3))
          .put("remotePath", c.getString(4)).put("twoWay", c.getInt(5) == 1).put("paused", c.getInt(6) == 1)
          .put("state", if (c.getInt(6) == 1) "paused" else c.getString(7)).put("reason", c.getString(8) ?: JSONObject.NULL)
          .apply { if (!c.isNull(9)) put("lastAt", c.getLong(9)) }
          .put("up", c.getInt(10)).put("down", c.getInt(11)).put("removed", c.getInt(12)).put("conflicts", c.getInt(13))
          .put("done", c.getInt(14)).put("total", c.getInt(15)).put("failed", c.getInt(16)))
      }
      return out
    }

    fun failures(): JSONArray {
      val out = JSONArray()
      readableDatabase.rawQuery("select f.pair, p.name, f.path, f.error from failed f join pairs p on p.id = f.pair order by f.at desc", null).use { c ->
        while (c.moveToNext()) out.put(JSONObject().put("pairId", c.getString(0)).put("pairName", c.getString(1)).put("path", c.getString(2)).put("error", c.getString(3)))
      }
      return out
    }

    fun add(j: JSONObject): String {
      val id = UUID.randomUUID().toString()
      writableDatabase.insert("pairs", null, ContentValues().apply {
        put("id", id); put("account", j.getString("accountId")); put("name", j.getString("name")); put("tree_uri", j.getString("treeUri"))
        put("folder_name", j.getString("folderName")); put("remote_id", if (j.isNull("remoteId")) null else j.getString("remoteId"))
        put("remote_path", j.getString("remotePath")); put("two_way", if (j.optBoolean("twoWay")) 1 else 0); put("created", System.currentTimeMillis())
      })
      return id
    }

    fun update(id: String, name: String, twoWay: Boolean, paused: Boolean) {
      writableDatabase.update("pairs", ContentValues().apply { put("name", name); put("two_way", if (twoWay) 1 else 0); put("paused", if (paused) 1 else 0) }, "id = ?", arrayOf(id))
    }

    fun remove(id: String) {
      writableDatabase.delete("pairs", "id = ?", arrayOf(id))
      writableDatabase.delete("files", "pair = ?", arrayOf(id))
      writableDatabase.delete("failed", "pair = ?", arrayOf(id))
    }

    fun state(id: String, state: String, reason: String? = null, done: Int? = null, total: Int? = null) {
      writableDatabase.update("pairs", ContentValues().apply {
        put("state", state); put("reason", reason)
        done?.let { put("done", it) }; total?.let { put("total", it) }
      }, "id = ?", arrayOf(id))
      changed()
    }

    fun finished(id: String, up: Int, down: Int, removed: Int, conflicts: Int) {
      writableDatabase.update("pairs", ContentValues().apply {
        put("state", "idle"); putNull("reason"); put("last_at", System.currentTimeMillis())
        put("up", up); put("down", down); put("removed", removed); put("conflicts", conflicts)
      }, "id = ?", arrayOf(id))
      changed()
    }

    fun base(pair: String): Map<String, Base> =
      readableDatabase.rawQuery("select path, sha, size, mtime, node_id, broken from files where pair = ?", arrayOf(pair)).use { c ->
        buildMap { while (c.moveToNext()) put(c.getString(0), Base(c.getString(1), c.getLong(2), c.getLong(3), c.getString(4), c.getInt(5) == 1)) }
      }

    fun put(pair: String, path: String, b: Base) {
      writableDatabase.insertWithOnConflict("files", null, ContentValues().apply {
        put("pair", pair); put("path", path); put("sha", b.sha); put("size", b.size); put("mtime", b.mtime)
        put("node_id", b.nodeId); put("broken", if (b.broken) 1 else 0)
      }, SQLiteDatabase.CONFLICT_REPLACE)
      writableDatabase.delete("failed", "pair = ? and path = ?", arrayOf(pair, path))
    }

    fun forget(pair: String, path: String) = writableDatabase.delete("files", "pair = ? and path = ?", arrayOf(pair, path))

    fun markBroken(pair: String, path: String) = writableDatabase.execSQL("update files set broken = 1 where pair = ? and path = ?", arrayOf(pair, path))

    fun fail(pair: String, path: String, error: String) {
      writableDatabase.insertWithOnConflict("failed", null, ContentValues().apply {
        put("pair", pair); put("path", path); put("error", error); put("at", System.currentTimeMillis())
      }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    // A failure that isn't there any more (the file went, or this run got further) clears itself.
    fun clearFailed(pair: String, path: String? = null) {
      if (path == null) writableDatabase.delete("failed", "pair = ?", arrayOf(pair))
      else writableDatabase.delete("failed", "pair = ? and path = ?", arrayOf(pair, path))
    }

    companion object {
      @Volatile private var instance: Db? = null
      fun of(context: Context) = instance ?: synchronized(this) { instance ?: Db(context.applicationContext).also { instance = it } }
    }
  }

  fun db(c: Context) = Db.of(c)

  fun add(c: Context, json: String): String {
    val j = JSONObject(json)
    // Expo hands back a document URI inside the tree; Android's grant is on the tree itself.
    val picked = Uri.parse(j.getString("treeUri"))
    val tree = DocumentsContract.buildTreeDocumentUri(picked.authority, DocumentsContract.getTreeDocumentId(picked))
    j.put("treeUri", tree.toString())
    // The folder must stay readable and writable after the app closes.
    val held = c.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission && it.isWritePermission }
    if (!held) try {
      c.contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    } catch (_: SecurityException) {
      throw Refused(0, "Android didn't let Nimbus keep access to that folder. Choose it again.")
    }
    val id = db(c).add(j)
    schedule(c)
    runNow(c, id)
    changed()
    return id
  }

  fun update(c: Context, id: String, name: String, twoWay: Boolean, paused: Boolean) {
    db(c).update(id, name, twoWay, paused)
    schedule(c)
    if (!paused) runNow(c, id)
    changed()
  }

  fun remove(c: Context, id: String) {
    val d = db(c)
    val tree = d.pairs("id = ?", arrayOf(id)).firstOrNull()?.treeUri
    WorkManager.getInstance(c).cancelUniqueWork("foldersync-now")
    Store.of(c).delete("source = 'sync' and media_id = ?", arrayOf(id))
    d.remove(id)
    // Let go of the folder unless another pair still uses it.
    if (tree != null && d.pairs("tree_uri = ?", arrayOf(tree)).isEmpty())
      runCatching { c.contentResolver.releasePersistableUriPermission(Uri.parse(tree), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    schedule(c)
    changed()
  }

  fun retry(c: Context, pair: String?) {
    val d = db(c)
    (if (pair == null) d.pairs() else d.pairs("id = ?", arrayOf(pair))).forEach { d.clearFailed(it.id) }
    runNow(c, pair)
    changed()
  }

  // ---- Scheduling ----

  // Every 15 minutes while any pair is running; nothing when none is.
  fun schedule(c: Context) {
    val wm = WorkManager.getInstance(c)
    if (db(c).pairs("paused = 0").isEmpty()) return run { wm.cancelUniqueWork("foldersync"); wm.cancelUniqueWork("foldersync-now") }
    val periodic = PeriodicWorkRequestBuilder<FolderSyncWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    wm.enqueueUniquePeriodicWork("foldersync", ExistingPeriodicWorkPolicy.UPDATE, periodic)
  }

  // `force`: the person pressed Sync now, which also confirms a held-back batch of deletions.
  fun runNow(c: Context, pair: String? = null, force: Boolean = false) {
    val data = Data.Builder().putBoolean("force", force).apply { pair?.let { putString("pair", it) } }.build()
    val req = OneTimeWorkRequestBuilder<FolderSyncWorker>()
      .setInputData(data)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("foldersync-now", ExistingWorkPolicy.REPLACE, req)
  }

  // The app opened.
  fun onStart(c: Context) {
    if (db(c).pairs("paused = 0").isEmpty()) return
    schedule(c)
    runNow(c)
  }

  // The server told us something changed for this account (a notification, live or pushed). KEEP: one waiting run is enough.
  fun signal(c: Context, account: String) {
    if (db(c).pairs("paused = 0 and account = ?", arrayOf(account)).isEmpty()) return
    val req = OneTimeWorkRequestBuilder<FolderSyncWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(c).enqueueUniqueWork("foldersync-signal", ExistingWorkPolicy.KEEP, req)
  }

  // Waiting for Wi-Fi or a charger, as camera backup does.
  fun waitFor(c: Context, wifi: Boolean) {
    val k = Constraints.Builder()
    if (wifi) k.setRequiredNetworkType(NetworkType.UNMETERED) else k.setRequiresCharging(true).setRequiredNetworkType(NetworkType.CONNECTED)
    val req = OneTimeWorkRequestBuilder<FolderSyncWorker>().setConstraints(k.build()).build()
    WorkManager.getInstance(c).enqueueUniqueWork(if (wifi) "foldersync-wifi" else "foldersync-charging", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
  }
}
