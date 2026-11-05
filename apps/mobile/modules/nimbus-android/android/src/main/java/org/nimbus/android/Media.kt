package org.nimbus.android

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

// The phone's photos and videos, as MediaStore lists them.
object Media {
  data class Item(
    val id: String, val uri: Uri, val name: String, val size: Long, val mime: String,
    val taken: Long, val bucketId: String, val bucket: String?, val camera: Boolean,
  )

  private fun granted(context: Context, permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  // "all", "partial" (Android 14's selected photos) or "none".
  fun access(context: Context) = when {
    Build.VERSION.SDK_INT >= 33 && granted(context, Manifest.permission.READ_MEDIA_IMAGES) -> "all"
    Build.VERSION.SDK_INT < 33 && granted(context, Manifest.permission.READ_EXTERNAL_STORAGE) -> "all"
    Build.VERSION.SDK_INT >= 34 && granted(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> "partial"
    else -> "none"
  }

  private val COLLECTIONS = listOf(
    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
  )

  fun all(context: Context): List<Item> {
    val out = ArrayList<Item>()
    val cols = arrayOf(
      MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.DATE_TAKEN, MediaStore.MediaColumns.DATE_MODIFIED,
      MediaStore.MediaColumns.BUCKET_ID, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH,
    )
    // Location stays in the bytes only with ACCESS_MEDIA_LOCATION and the "original" URI.
    val original = Build.VERSION.SDK_INT >= 29 && granted(context, Manifest.permission.ACCESS_MEDIA_LOCATION)
    for (collection in COLLECTIONS) {
      runCatching {
        context.contentResolver.query(collection, cols, "${MediaStore.MediaColumns.IS_PENDING} = 0", null, null)?.use { c ->
          while (c.moveToNext()) {
            val id = c.getLong(0)
            val item = ContentUris.withAppendedId(collection, id)
            val bucket = c.getString(7)
            out += Item(
              id = "${if (collection == COLLECTIONS[0]) "i" else "v"}$id",
              uri = if (original) MediaStore.setRequireOriginal(item) else item,
              name = c.getString(1) ?: "$id",
              size = c.getLong(2),
              mime = c.getString(3) ?: "",
              taken = Rules.takenAt(if (c.isNull(4)) null else c.getLong(4), c.getLong(5)),
              bucketId = c.getString(6) ?: "",
              bucket = bucket,
              camera = Rules.isCamera(c.getString(8), bucket),
            )
          }
        }
      }
    }
    return out
  }

  // Every album with its count and size; the camera is marked.
  fun albums(context: Context): String {
    data class A(val name: String, var count: Int, var bytes: Long, val camera: Boolean)
    val map = LinkedHashMap<String, A>()
    for (i in all(context)) {
      val key = if (i.camera) "camera" else i.bucketId
      val a = map.getOrPut(key) { A(if (i.camera) "Camera" else i.bucket ?: "Album", 0, 0, i.camera) }
      a.count++
      a.bytes += i.size
    }
    val out = JSONArray()
    for ((id, a) in map.entries.sortedWith(compareBy({ !it.value.camera }, { it.value.name.lowercase() })))
      out.put(JSONObject().put("id", id).put("name", a.name).put("count", a.count).put("bytes", a.bytes).put("camera", a.camera))
    return out.toString()
  }

  fun name(context: Context, assetId: String): String? = runCatching {
    context.contentResolver.query(
      MediaStore.Files.getContentUri("external"), arrayOf(MediaStore.MediaColumns.DISPLAY_NAME),
      "${MediaStore.MediaColumns._ID} = ?", arrayOf(assetId), null
    )?.use { if (it.moveToFirst()) it.getString(0) else null }
  }.getOrNull()

  fun uriOf(id: String): Uri {
    val collection = if (id.startsWith("i")) COLLECTIONS[0] else COLLECTIONS[1]
    return ContentUris.withAppendedId(collection, id.drop(1).toLong())
  }
}
