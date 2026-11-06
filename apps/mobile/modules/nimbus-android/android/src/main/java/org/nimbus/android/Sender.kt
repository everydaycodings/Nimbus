package org.nimbus.android

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

// Sends one queued file: hash, tus in parts from wherever the server got to, then finish and a
// thumbnail. Shared by manual uploads and camera backup.
class Sender(context: Context, private val stopped: () -> Boolean) {
  private val ctx = context.applicationContext
  private val store = Store.of(ctx)
  private val lastWrite = HashMap<String, Long>()

  // AUTH and FULL are about the account, not the file: everything else would fail the same way.
  enum class Outcome { DONE, FAILED, HALTED, OFFLINE, AUTH, FULL }

  private fun fail(row: Store.Row, message: String): Outcome {
    store.set(row.id, "status" to "failed", "error" to message, "fk_sealed" to null)
    Uploads.release(ctx, row.uri)
    return Outcome.FAILED
  }

  private fun open(uri: String): InputStream =
    ctx.contentResolver.openInputStream(Uri.parse(uri)) ?: throw FileNotFoundException(uri)

  private fun checkHalt(id: String?) {
    if ((id != null && id in Uploads.halted) || stopped()) throw Halted()
  }

  fun hash(uri: Uri, id: String?): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(1 shl 20)
    var read = 0L
    (ctx.contentResolver.openInputStream(uri) ?: throw FileNotFoundException(uri.toString())).use { input ->
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
        read += n
        if (read % (64L shl 20) < n) checkHalt(id)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun meta(row: Store.Row, token: String) = mapOf(
    "filename" to row.path.substringAfterLast('/'),
    "filetype" to row.mime,
    "token" to token,
    "path" to row.path,
    "onConflict" to row.onConflict,
  )

  // A fresh plan token: the old one is over a day old, or the server forgot the upload.
  private fun replan(account: Accounts.Account, first: Store.Row): String {
    checkBase(account, first)
    val row = store.get(first.id) ?: first
    val plan = Net.api(account, "POST", "/api/v1/uploads/plan", JSONObject()
      .put("parentId", row.parentId ?: JSONObject.NULL)
      .put("entries", JSONArray().put(JSONObject().put("path", row.path).put("size", row.size))))
    plan.optString("error").takeIf { it.isNotEmpty() }?.let { throw Refused(400, it) }
    plan.optJSONArray("rejected")?.optJSONObject(0)?.let { throw Refused(400, it.optString("reason")) }
    return plan.getString("token").also { store.set(row.id, "plan_token" to it, "planned" to System.currentTimeMillis()) }
  }

  // A save from the Files app started from `baseVersion`. If the server has moved on, the edit goes
  // beside the file as "name (conflict).ext" instead of becoming a version. A renamed file keeps its new name.
  private fun checkBase(account: Accounts.Account, row: Store.Row) {
    val node = row.baseNode ?: return
    val base = row.baseVersion ?: return
    val item = try {
      Net.api(account, "GET", "/api/v1/items/$node").optJSONObject("item")
    } catch (e: Refused) {
      if (e.status == 404) null else throw e
    } ?: return // Gone from the server: the plan below decides what happens.
    val current = if (item.isNull("version")) null else item.getString("version")
    val name = item.getString("name")
    if (current != base) {
      val beside = DocIds.conflictName(name)
      store.set(row.id, "path" to beside, "name" to beside, "on_conflict" to "rename", "base_node" to null, "base_version" to null)
    } else if (name != row.path) {
      store.set(row.id, "path" to name, "name" to name)
    }
  }

  private fun readFully(input: InputStream, buf: ByteArray, want: Int): Int {
    var got = 0
    while (got < want) {
      val n = input.read(buf, got, want - got)
      if (n < 0) break
      got += n
    }
    return got
  }

  // A vault upload sends ciphertext made on the way out from the plaintext file: no hash, no replan
  // (only the JS can plan one, with the vault open), no thumbnail. Parts are whole cipher chunks, so
  // it resumes from wherever the server got to, with the same file key.
  private fun sendVault(account: Accounts.Account, first: Store.Row): Outcome {
    var row = first
    val stale = "Open the vault and try again."
    val fk = row.fkSealed?.let { JobKey.open(it) } ?: return fail(row, stale)
    try {
      val total = Vault.cipherSize(row.size)
      for (attempt in 0..1) {
        var url = row.uploadUrl
        var offset = url?.let { Tus.offset(it) }
        if (url == null || offset == null) {
          if (url != null || System.currentTimeMillis() - row.planned >= 23 * 3600_000L) return fail(row, stale)
          val meta = mutableMapOf("filename" to row.sealedName!!, "nameTag" to row.nameTag!!, "token" to row.planToken, "encKey" to row.encKey!!)
          row.replaces?.let { meta["replaces"] = it }
          url = Tus.create(row.tusUrl, total, meta)
          offset = 0L
          store.set(row.id, "upload_url" to url, "sent" to 0L)
        }
        var at: Long = offset
        var lost = false
        while (at < total) {
          checkHalt(row.id)
          val start = at
          val end = minOf(start + VAULT_PART, total)
          var inPart = 0L
          val next = Tus.patchStream(url, start, end - start, { Vault.encryptRange(fk, row.size, { open(row.uri) }, start, end, it) }) { bytes ->
            checkHalt(row.id)
            row.speedCap?.let { Uploads.pace(bytes, it) }
            inPart += bytes
            val now = System.currentTimeMillis()
            if (now - (lastWrite[row.id] ?: 0) > 500) {
              lastWrite[row.id] = now
              store.set(row.id, "sent" to minOf(start + inPart, row.size))
            }
          }
          if (next == null) { lost = true; break }
          at = next
          store.set(row.id, "sent" to minOf(next, row.size))
        }
        if (!lost) break
        store.set(row.id, "upload_url" to null, "sent" to 0L)
        row = store.get(row.id) ?: return Outcome.HALTED
        if (attempt == 1) return fail(row, "The server lost this upload twice. Try again later.")
      }
      val done = Net.api(account, "POST", "/api/v1/uploads/finish", JSONObject().put("uploadUrl", store.get(row.id)?.uploadUrl))
      store.set(row.id, "status" to "done", "sent" to row.size, "node_id" to done.optString("nodeId").ifEmpty { null }, "version_id" to done.optString("versionId").ifEmpty { null }, "error" to null, "fk_sealed" to null)
      Uploads.release(ctx, row.uri)
      return Outcome.DONE
    } finally {
      fk.fill(0)
    }
  }

  fun send(first: Store.Row): Outcome {
    var row = first
    val account = Accounts.get(ctx, row.account) ?: run {
      store.set(row.id, "status" to "queued")
      return Outcome.AUTH
    }
    try {
      if (row.vaultId != null) return sendVault(account, row)
      val sha = row.sha ?: hash(Uri.parse(row.uri), row.id).also { store.set(row.id, "sha" to it) }
      for (attempt in 0..1) {
        var url = row.uploadUrl
        var offset = url?.let { Tus.offset(it) }
        if (url == null || offset == null) {
          val fresh = url == null && System.currentTimeMillis() - row.planned < 23 * 3600_000L
          val token = if (fresh) row.planToken else replan(account, row)
          if (!fresh) row = store.get(row.id) ?: return Outcome.HALTED // replan may have renamed it
          url = Tus.create(row.tusUrl, row.size, meta(row, token))
          offset = 0L
          store.set(row.id, "upload_url" to url, "sent" to 0L)
        }
        val part = row.speedCap?.let { (it * 2).coerceIn(256L * 1024, PART.toLong()).toInt() } ?: PART
        val buf = ByteArray(part)
        var at: Long = offset
        var lost = false
        open(row.uri).use { input ->
          var skipped = 0L
          while (skipped < at) {
            val n = input.skip(at - skipped)
            if (n <= 0) throw IOException("Couldn't skip ahead in the file")
            skipped += n
          }
          while (at < row.size) {
            checkHalt(row.id)
            val n = readFully(input, buf, minOf(part.toLong(), row.size - at).toInt())
            if (n <= 0) throw Refused(0, "This file changed or got shorter while it was uploading. Try again.")
            val start = at
            var inPart = 0L
            val next = Tus.patch(url, start, buf, n) { bytes ->
              checkHalt(row.id)
              row.speedCap?.let { Uploads.pace(bytes, it) }
              inPart += bytes
              val now = System.currentTimeMillis()
              if (now - (lastWrite[row.id] ?: 0) > 500) {
                lastWrite[row.id] = now
                store.set(row.id, "sent" to start + inPart)
              }
            }
            if (next == null) { lost = true; break }
            at = next
            store.set(row.id, "sent" to next)
          }
        }
        if (!lost) break
        // The server forgot this upload: start it again, once.
        store.set(row.id, "upload_url" to null, "sent" to 0L)
        row = store.get(row.id) ?: return Outcome.HALTED
        if (attempt == 1) return fail(row, "The server lost this upload twice. Try again later.")
      }

      val done = Net.api(account, "POST", "/api/v1/uploads/finish", JSONObject().put("uploadUrl", store.get(row.id)?.uploadUrl).put("sha256", sha))
      val nodeId = done.optString("nodeId").ifEmpty { null }
      val versionId = done.optString("versionId").ifEmpty { null }
      if (nodeId != null && versionId != null && (row.mime.startsWith("image/") || row.mime.startsWith("video/"))) {
        val webp = Thumbs.of(ctx, Uri.parse(row.uri), row.mime)
        // An empty post tells the server not to wait for a video thumbnail; images it can draw itself.
        if (webp != null || row.mime.startsWith("video/")) Net.thumb(account, nodeId, versionId, webp)
      }
      // A file made in the Files app starts as an empty placeholder; once its real bytes land, drop that empty version.
      store.get(row.id)?.let { now ->
        val base = now.baseVersion
        if (base != null && nodeId != null && nodeId == now.baseNode) try {
          val vs = Net.api(account, "GET", "/api/v1/items/$nodeId/versions").getJSONArray("versions")
          for (i in 0 until vs.length()) {
            val v = vs.getJSONObject(i)
            if (v.getString("id") == base && v.getLong("size") == 0L && !v.getBoolean("current")) Net.api(account, "DELETE", "/api/v1/versions/$base")
          }
        } catch (_: Exception) {} // only tidying; the save itself is done
      }
      val dup = done.optJSONObject("duplicateOf")
      store.set(row.id, "status" to "done", "sent" to row.size, "node_id" to nodeId, "version_id" to versionId, "dup_id" to dup?.optString("id"), "dup_path" to dup?.optString("path"), "error" to null)
      Uploads.release(ctx, row.uri)
      return Outcome.DONE
    } catch (_: Halted) {
      Uploads.halted.remove(row.id)
      if (store.status(row.id) == "uploading") store.set(row.id, "status" to "queued")
      return Outcome.HALTED
    } catch (e: Refused) {
      if (e.status == 401) {
        store.set(row.id, "status" to "queued")
        return Outcome.AUTH
      }
      if (e.message?.startsWith("Not enough space") == true) {
        store.set(row.id, "status" to "failed", "error" to e.message)
        return Outcome.FULL
      }
      return fail(row, e.message ?: "The server refused this upload.")
    } catch (_: FileNotFoundException) {
      return fail(row, "This file is no longer on this phone.")
    } catch (_: SecurityException) {
      return fail(row, "Nimbus can no longer read this file. Choose it again to upload it.")
    } catch (_: IOException) {
      if (store.status(row.id) == "uploading") store.set(row.id, "status" to "queued", "error" to null)
      return Outcome.OFFLINE
    }
  }

  companion object {
    const val PART = 8 * 1024 * 1024
    // 16 cipher chunks, as on the web.
    const val VAULT_PART = 16L * Vault.CIPHER_CHUNK
  }
}
