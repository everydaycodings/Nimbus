package org.nimbus.android

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import okhttp3.Call
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.GeneralSecurityException
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

// Decrypt and zip jobs, each on its own thread so JS keeps going. Cancel is by job id.
object VaultFiles {
  class Run(val scope: String) {
    @Volatile var cancelled = false
    @Volatile var call: Call? = null
    fun cancel() { cancelled = true; call?.cancel() }
  }

  class ZipItem(val url: String, val fk: ByteArray, val path: String, val cipherSize: Long?)

  private val runs = ConcurrentHashMap<String, Run>()

  fun cancel(jobId: String) { runs[jobId]?.cancel() }
  // Locking a vault stops what it was still decrypting.
  fun cancelScope(prefix: String) = runs.values.filter { it.scope.startsWith(prefix) }.forEach { it.cancel() }

  private fun openDest(ctx: Context, dest: String): OutputStream =
    if (dest.startsWith("content://")) ctx.contentResolver.openOutputStream(Uri.parse(dest), "w") ?: throw IOException("Couldn't write there.")
    else File(dest).also { it.parentFile?.mkdirs() }.outputStream()

  private fun deleteDest(ctx: Context, dest: String) {
    if (dest.startsWith("content://")) runCatching { DocumentsContract.deleteDocument(ctx.contentResolver, Uri.parse(dest)) }
    else File(dest).delete()
  }

  // GET with no auth header: the presigned URL carries its own.
  private fun <T> fetch(run: Run, url: String, use: (InputStream, Long) -> T): T {
    val call = Net.client.newCall(Request.Builder().url(url).build())
    run.call = call
    call.execute().use { res ->
      if (!res.isSuccessful) throw IOException("The server refused this file (${res.code}).")
      val body = res.body ?: throw IOException("The server sent nothing.")
      return use(body.byteStream(), body.contentLength())
    }
  }

  private fun message(e: Throwable) = when (e) {
    is GeneralSecurityException -> "This file is damaged, incomplete or not from this vault."
    else -> e.message ?: "Couldn't open this file."
  }

  private fun start(ctx: Context, jobId: String, scope: String, dest: String, promise: Promise, keys: List<ByteArray>, body: (Run) -> Unit) {
    val run = Run(scope)
    runs[jobId] = run
    Thread {
      try {
        body(run)
        promise.resolve(null)
      } catch (e: Throwable) {
        deleteDest(ctx, dest)
        promise.reject(CodedException(if (run.cancelled) "cancelled" else message(e)))
      } finally {
        keys.forEach { it.fill(0) }
        runs.remove(jobId)
      }
    }.start()
  }

  private fun decryptTo(run: Run, url: String, fk: ByteArray, out: OutputStream, before: Long, total: Long, progress: (Long, Long) -> Unit) =
    fetch(run, url) { input, length ->
      val size = if (length >= 0) Vault.plainSize(length) else total
      Vault.decryptStream(fk, input, out) { done ->
        if (run.cancelled) throw IOException("cancelled")
        progress(before + done, maxOf(total, size))
      }
    }

  // Takes ownership of `fk` and zeroes it at the end.
  fun decrypt(ctx: Context, jobId: String, scope: String, fk: ByteArray, url: String, dest: String, promise: Promise, progress: (Long, Long) -> Unit) =
    start(ctx, jobId, scope, dest, promise, listOf(fk)) { run ->
      openDest(ctx, dest).use { out -> decryptTo(run, url, fk, out, 0, 0, progress) }
    }

  // Entries decrypt as they stream, so nothing plaintext is held. total is 0 unless every item has its size.
  fun zip(ctx: Context, jobId: String, scope: String, items: List<ZipItem>, dest: String, promise: Promise, progress: (Long, Long) -> Unit) =
    start(ctx, jobId, scope, dest, promise, items.map { it.fk }) { run ->
      val total = if (items.all { it.cipherSize != null }) items.sumOf { Vault.plainSize(it.cipherSize!!) } else 0L
      var before = 0L
      ZipOutputStream(openDest(ctx, dest).buffered()).use { zip ->
        for (item in items) {
          // No ".." or leading slash: a name from a vault must not climb out when unzipped.
          zip.putNextEntry(ZipEntry(item.path.split('/').filter { it.isNotEmpty() && it != ".." }.joinToString("/")))
          var itemDone = 0L
          decryptTo(run, item.url, item.fk, zip, before, total) { done, t -> itemDone = done - before; progress(done, t) }
          zip.closeEntry()
          before += itemDone
        }
      }
    }
}
