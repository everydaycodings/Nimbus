package org.nimbus.android

import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.TimeUnit

// A server answer that isn't a network failure: retrying the same request won't help.
class Refused(val status: Int, message: String) : Exception(message)

object Net {
  val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .writeTimeout(60, TimeUnit.SECONDS)
    .build()

  private val JSON = "application/json".toMediaType()

  // The app's own API, as the app calls it: bearer token, `origin: nimbus://`, no cookies.
  fun api(account: Accounts.Account, method: String, path: String, body: JSONObject? = null): JSONObject {
    val req = Request.Builder().url(account.server + path)
      .header("authorization", "Bearer ${account.token}")
      .header("origin", "nimbus://")
      .method(method, body?.toString()?.toRequestBody(JSON))
      .build()
    client.newCall(req).execute().use { res ->
      val text = res.body?.string().orEmpty()
      if (!res.isSuccessful) {
        val message = runCatching { JSONObject(text).optString("message") }.getOrNull()?.ifEmpty { null }
        throw Refused(res.code, message ?: if (res.code == 401) "Sign in again to finish this upload." else "The server refused this (${res.code}).")
      }
      return if (text.isBlank()) JSONObject() else JSONObject(text)
    }
  }

  fun thumb(account: Accounts.Account, nodeId: String, versionId: String, webp: ByteArray?) {
    val req = Request.Builder().url("${account.server}/api/files/$nodeId/thumb?v=$versionId")
      .header("authorization", "Bearer ${account.token}")
      .header("origin", "nimbus://")
      .post((webp ?: ByteArray(0)).toRequestBody(if (webp != null) "image/webp".toMediaType() else null))
      .build()
    runCatching { client.newCall(req).execute().close() }
  }
}

// tus 1.0.0, the parts the uploader needs.
object Tus {
  private val OCTETS = "application/offset+octet-stream".toMediaType()
  private const val VERSION = "1.0.0"

  private fun b64(s: String) = Base64.encodeToString(s.toByteArray(), Base64.NO_WRAP)

  fun create(endpoint: String, size: Long, meta: Map<String, String>): String {
    val req = Request.Builder().url(endpoint)
      .header("Tus-Resumable", VERSION)
      .header("Upload-Length", size.toString())
      .header("Upload-Metadata", meta.entries.joinToString(",") { "${it.key} ${b64(it.value)}" })
      .post(ByteArray(0).toRequestBody(null))
      .build()
    Net.client.newCall(req).execute().use { res ->
      if (res.code !in 200..299) throw Refused(res.code, refusal(res.body?.string(), res.code))
      val location = res.header("Location") ?: throw IOException("No upload address from the server")
      return Request.Builder().url(endpoint).build().url.resolve(location).toString()
    }
  }

  // Null: the server has forgotten this upload (expired or swept), so it has to start again.
  fun offset(url: String): Long? {
    val req = Request.Builder().url(url).header("Tus-Resumable", VERSION).head().build()
    Net.client.newCall(req).execute().use { res ->
      if (res.code == 404 || res.code == 410) return null
      if (!res.isSuccessful) throw IOException("HEAD ${res.code}")
      return res.header("Upload-Offset")?.toLong() ?: throw IOException("No offset from the server")
    }
  }

  // Null as above. `onBytes` hears each slice as it goes, for progress and pacing.
  fun patch(url: String, offset: Long, bytes: ByteArray, length: Int, onBytes: (Int) -> Unit): Long? =
    patchStream(url, offset, length.toLong(), { it.write(bytes, 0, length) }, onBytes)

  // Same, with the body made as it is sent (vault parts are encrypted on the way out).
  // `produce` may run again if OkHttp retries the request, so it must start from the beginning each time.
  fun patchStream(url: String, offset: Long, length: Long, produce: (OutputStream) -> Unit, onBytes: (Int) -> Unit): Long? {
    val body = object : RequestBody() {
      override fun contentType() = OCTETS
      override fun contentLength() = length
      override fun writeTo(sink: BufferedSink) {
        produce(object : OutputStream() {
          override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
          override fun write(b: ByteArray, off: Int, len: Int) {
            var at = 0
            while (at < len) {
              val n = minOf(SLICE, len - at)
              sink.write(b, off + at, n)
              sink.flush()
              at += n
              onBytes(n)
            }
          }
        })
      }
    }
    val req = Request.Builder().url(url)
      .header("Tus-Resumable", VERSION)
      .header("Upload-Offset", offset.toString())
      .patch(body)
      .build()
    Net.client.newCall(req).execute().use { res ->
      if (res.code == 404 || res.code == 410) return null
      if (res.code == 409) return offset(url) // Out of step: ask where the server is.
      if (!res.isSuccessful) throw if (res.code in 400..499) Refused(res.code, refusal(res.body?.string(), res.code)) else IOException("PATCH ${res.code}")
      return res.header("Upload-Offset")?.toLong() ?: (offset + length)
    }
  }

  fun delete(url: String) {
    runCatching { Net.client.newCall(Request.Builder().url(url).header("Tus-Resumable", VERSION).delete().build()).execute().close() }
  }

  // The hooks' refusal text is meant for people; anything long or empty gets a plain line instead.
  private fun refusal(body: String?, code: Int) = body?.trim()?.takeIf { it.isNotEmpty() && it.length < 200 } ?: "The server refused this upload ($code)."

  private const val SLICE = 64 * 1024
}
