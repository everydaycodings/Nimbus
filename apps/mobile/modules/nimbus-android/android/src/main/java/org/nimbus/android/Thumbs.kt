package org.nimbus.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.ByteArrayOutputStream

// The web's thumbnail: WebP, longest side 480, under the server's 512 KB. The server's worker skips
// video, so a client has to draw those.
object Thumbs {
  private const val SIZE = 480
  private const val MAX = 512 * 1024

  fun of(context: Context, uri: Uri, mime: String): ByteArray? = runCatching {
    val bitmap = when {
      mime.startsWith("video/") -> MediaMetadataRetriever().run {
        try {
          setDataSource(context, uri)
          getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: getFrameAtTime()
        } finally { release() }
      }
      mime.startsWith("image/") -> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIZE) sample *= 2
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
      }
      else -> null
    } ?: return null
    val scale = SIZE.toFloat() / maxOf(bitmap.width, bitmap.height)
    val fitted = if (scale < 1) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
    for (quality in intArrayOf(80, 60, 40)) {
      val out = ByteArrayOutputStream()
      @Suppress("DEPRECATION")
      fitted.compress(if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP, quality, out)
      if (out.size() <= MAX) return out.toByteArray()
    }
    null
  }.getOrNull()
}
