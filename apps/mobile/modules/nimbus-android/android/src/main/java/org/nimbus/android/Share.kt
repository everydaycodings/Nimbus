package org.nimbus.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

// Files another app shared in. Android's permission to read them ends with the share, so whatever
// can't be kept is copied into the app's own storage when it's queued.
object Share {
  @Volatile private var pending: List<Uri> = emptyList()

  // Only another app's content:// grant is a share. file:// would let a sender name any file the app
  // can read, and our own content authorities would hand the app's files back to itself.
  fun acceptable(scheme: String?, authority: String?): Boolean =
    scheme == "content" && authority != null && !authority.startsWith("org.nimbus.drive")

  fun take(intent: Intent?): Boolean {
    if (intent == null) return false
    val shared = when (intent.action) {
      Intent.ACTION_SEND -> listOfNotNull(stream(intent))
      Intent.ACTION_SEND_MULTIPLE -> streams(intent)
      else -> return false
    }
    val uris = shared.filter { acceptable(it.scheme, it.authority) }
    // Consumed, so a rotation or relaunch doesn't offer it twice.
    intent.action = Intent.ACTION_MAIN
    if (uris.isEmpty()) return false
    pending = uris
    return true
  }

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()

  // Once: the list empties as it's read.
  fun files(context: Context): String {
    val out = JSONArray()
    for (uri in pending.also { pending = emptyList() }) {
      var name: String? = null
      var size = -1L
      runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
          if (it.moveToFirst()) {
            name = it.getString(0)
            if (!it.isNull(1)) size = it.getLong(1)
          }
        }
      }
      if (size < 0) size = runCatching { context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull() ?: -1
      out.put(JSONObject()
        .put("uri", uri.toString())
        .put("name", name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "Shared file")
        .put("size", maxOf(size, 0))
        .put("mime", context.contentResolver.getType(uri) ?: ""))
    }
    return out.toString()
  }

  // A read grant that can't be kept: copy the bytes now, while the grant still holds.
  fun keep(context: Context, uri: String): String {
    if (!uri.startsWith("content://")) return uri
    val parsed = Uri.parse(uri)
    val kept = runCatching {
      context.contentResolver.takePersistableUriPermission(parsed, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }.isSuccess
    if (kept) return uri
    val dir = File(context.filesDir, "shared").apply { mkdirs() }
    val copy = File(dir, UUID.randomUUID().toString())
    context.contentResolver.openInputStream(parsed)!!.use { input -> copy.outputStream().use { input.copyTo(it, 1 shl 20) } }
    return Uri.fromFile(copy).toString()
  }

  // The copy goes once its upload is over.
  fun forget(context: Context, uri: String) {
    if (!uri.startsWith("file://")) return
    val file = File(Uri.parse(uri).path ?: return)
    if (file.parentFile == File(context.filesDir, "shared")) file.delete()
  }
}
