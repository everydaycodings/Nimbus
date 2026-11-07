package org.nimbus.android

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Vault encryption, byte for byte what packages/shared/vault-crypto.ts does (VaultTest checks it
// against vectors the web code made). Keys are raw 32-byte arrays. Nothing here touches Android.
object Vault {
  const val CHUNK = 4 * 1024 * 1024
  const val TAG = 16
  const val CIPHER_CHUNK = CHUNK + TAG
  const val KDF_T = 3
  const val KDF_M = 64 * 1024 // KiB

  // Same alphabet as the web: no I, O, 0 or 1.
  private const val B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  private val rng = SecureRandom()

  fun random(n: Int) = ByteArray(n).also { rng.nextBytes(it) }
  fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
  fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

  private fun gcm(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray?, data: ByteArray, off: Int = 0, len: Int = data.size): ByteArray {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    aad?.let { c.updateAAD(it) }
    return c.doFinal(data, off, len)
  }

  // iv12||ct. Opening with the wrong key throws (GCM refuses).
  fun seal(kek: ByteArray, plain: ByteArray): String {
    val iv = random(12)
    return b64(iv + gcm(Cipher.ENCRYPT_MODE, kek, iv, null, plain))
  }

  fun open(kek: ByteArray, sealed: String): ByteArray {
    val b = unb64(sealed)
    return gcm(Cipher.DECRYPT_MODE, kek, b.copyOfRange(0, 12), null, b, 12, b.size - 12)
  }

  // ponytail: BouncyCastle's Argon2 is pure Java, ~1-3 s at 64 MB on mid phones; swap to argon2kt (native) if unlock feels slow.
  fun passphraseKey(passphrase: String, salt: String, t: Int, m: Int): ByteArray {
    val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
      .withVersion(Argon2Parameters.ARGON2_VERSION_13)
      .withIterations(t).withMemoryAsKB(m).withParallelism(1).withSalt(unb64(salt)).build()
    val out = ByteArray(32)
    Argon2BytesGenerator().apply { init(params) }.generateBytes(Normalizer.normalize(passphrase, Normalizer.Form.NFC).toByteArray(Charsets.UTF_8), out)
    return out
  }

  // HKDF-SHA256 with an empty salt (an HMAC key of zeros, which is what an empty one means).
  fun hkdf(ikm: ByteArray, info: String, len: Int): ByteArray {
    fun mac(key: ByteArray, data: ByteArray) = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)
    val prk = mac(ByteArray(32), ikm)
    val out = ByteArray(len)
    var t = ByteArray(0)
    var at = 0
    var i = 1
    while (at < len) {
      t = mac(prk, t + info.toByteArray(Charsets.UTF_8) + byteArrayOf(i++.toByte()))
      val n = minOf(t.size, len - at)
      System.arraycopy(t, 0, out, at, n)
      at += n
    }
    return out
  }

  fun recoveryBytes(code: String): ByteArray {
    val chars = code.uppercase(Locale.ROOT).filter { it in 'A'..'Z' || it in '0'..'9' }
    var bits = 0
    var acc = 0
    val out = ArrayList<Byte>()
    for (c in chars) {
      val v = B32.indexOf(c)
      if (v < 0) throw IllegalArgumentException("bad recovery code")
      acc = (acc shl 5) or v
      bits += 5
      if (bits >= 8) {
        bits -= 8
        out.add(((acc shr bits) and 255).toByte())
      }
    }
    if (out.size != 32) throw IllegalArgumentException("bad recovery code")
    return out.toByteArray()
  }

  fun recoveryCode(bytes: ByteArray): String {
    var bits = 0
    var acc = 0
    val s = StringBuilder()
    for (b in bytes) {
      acc = (acc shl 8) or (b.toInt() and 255)
      bits += 8
      while (bits >= 5) {
        bits -= 5
        s.append(B32[(acc shr bits) and 31])
      }
    }
    if (bits > 0) s.append(B32[(acc shl (5 - bits)) and 31])
    return s.chunked(4).joinToString("-")
  }

  private fun recoveryKey(code: String) = hkdf(recoveryBytes(code), "nimbus-vault-recovery", 32)

  class Created(val vk: ByteArray, val salt: String, val t: Int, val m: Int, val recoveryCode: String, val wrapped: String, val recoveryWrapped: String)

  fun newVault(passphrase: String, t: Int = KDF_T, m: Int = KDF_M): Created {
    val vk = random(32)
    val salt = b64(random(16))
    val code = recoveryCode(random(32))
    return Created(vk, salt, t, m, code, seal(passphraseKey(passphrase, salt, t, m), vk), seal(recoveryKey(code), vk))
  }

  fun unlockWithPassphrase(salt: String, wrapped: String, t: Int, m: Int, passphrase: String) =
    open(passphraseKey(passphrase, salt, t, m), wrapped)

  fun unlockWithRecovery(recoveryWrapped: String, code: String) = open(recoveryKey(code), recoveryWrapped)

  class Wrapped(val salt: String, val t: Int, val m: Int, val wrapped: String)

  // New salt and wrapped key for a changed passphrase; files and the recovery copy stay as they are.
  fun rewrap(vk: ByteArray, passphrase: String, t: Int = KDF_T, m: Int = KDF_M): Wrapped {
    val salt = b64(random(16))
    return Wrapped(salt, t, m, seal(passphraseKey(passphrase, salt, t, m), vk))
  }

  // Names are {"n": name, "t": mime or null} under the vault key.
  fun encName(vk: ByteArray, name: String, mime: String?) =
    seal(vk, JSONObject().put("n", name).put("t", mime ?: JSONObject.NULL).toString().toByteArray(Charsets.UTF_8))

  fun decName(vk: ByteArray, sealed: String): Pair<String, String?> {
    val j = JSONObject(String(open(vk, sealed), Charsets.UTF_8))
    return j.getString("n") to if (j.isNull("t")) null else j.getString("t")
  }

  // A name's fingerprint so the server can refuse two same-named items without reading either.
  // Web: deriveKey to HMAC with no length gives a 64-byte key (the block size), hence 64 here.
  fun nameTag(vk: ByteArray, name: String): String {
    val key = hkdf(vk, "nimbus-vault-names", 64)
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
    return b64(mac.doFinal(Normalizer.normalize(name, Normalizer.Form.NFC).lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8)).copyOf(16))
  }

  fun newFileKey(vk: ByteArray): Pair<ByteArray, String> = random(32).let { it to seal(vk, it) }
  fun openFileKey(vk: ByteArray, wrapped: String) = open(vk, wrapped)

  // ---- Share links: the format is written up above LinkFile in packages/shared/vault-crypto.ts ----
  // A link key (LK) is 32 random bytes. A file's key for the link is seal(LK, FK), the manifest is
  // seal(LK, JSON), and LK rides in the URL's # as unpadded base64url (or, in passphrase mode, is
  // sealed by Argon2id(passphrase), which is exactly what `rewrap` does for any key).
  fun b64url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
  fun unb64url(s: String): ByteArray = Base64.getUrlDecoder().decode(s)
  fun wrapForLink(lk: ByteArray, fk: ByteArray) = seal(lk, fk)
  fun unwrapFromLink(lk: ByteArray, wrapped: String) = open(lk, wrapped)
  fun sealManifest(lk: ByteArray, json: String) = seal(lk, json.toByteArray(Charsets.UTF_8))
  fun openManifest(lk: ByteArray, sealed: String) = String(open(lk, sealed), Charsets.UTF_8)

  class Link(val key: String?, val manifest: String, val salt: String?, val t: Int?, val m: Int?, val wrappedLinkKey: String?)

  // Re-wraps each file's key (opened with the vault key) under a new link key. `files` carry
  // path, size, mime, versionId and encKey; the manifest has fileKey in place of encKey.
  fun makeLink(vk: ByteArray, files: List<JSONObject>, passphrase: String?): Link {
    val lk = random(32)
    val arr = org.json.JSONArray()
    for (f in files) {
      val fk = openFileKey(vk, f.getString("encKey"))
      arr.put(JSONObject().put("path", f.getString("path")).put("size", f.getLong("size"))
        .put("mime", if (f.isNull("mime")) JSONObject.NULL else f.getString("mime"))
        .put("versionId", f.getString("versionId")).put("fileKey", wrapForLink(lk, fk)))
      fk.fill(0)
    }
    val sealed = sealManifest(lk, arr.toString())
    if (passphrase == null) return Link(b64url(lk), sealed, null, null, null, null)
    val w = rewrap(lk, passphrase)
    return Link(null, sealed, w.salt, w.t, w.m, w.wrapped)
  }

  private fun chunkCount(size: Long) = maxOf(1L, (size + CHUNK - 1) / CHUNK)
  fun cipherSize(size: Long) = size + TAG * chunkCount(size)
  fun plainSize(cipher: Long) = cipher - TAG * maxOf(1L, (cipher + CIPHER_CHUNK - 1) / CIPHER_CHUNK)

  // IV is 0000||index (u64 big-endian); AAD is index||last.
  private fun chunk(mode: Int, fk: ByteArray, index: Long, last: Boolean, data: ByteArray, len: Int = data.size): ByteArray {
    val idx = ByteBuffer.allocate(8).putLong(index).array()
    val iv = ByteArray(4) + idx
    return gcm(mode, fk, iv, idx + byteArrayOf(if (last) 1 else 0), data, 0, len)
  }

  fun encryptChunk(fk: ByteArray, index: Long, last: Boolean, pt: ByteArray) = chunk(Cipher.ENCRYPT_MODE, fk, index, last, pt)
  fun decryptChunk(fk: ByteArray, index: Long, last: Boolean, ct: ByteArray, len: Int = ct.size) = chunk(Cipher.DECRYPT_MODE, fk, index, last, ct, len)

  private fun readFully(input: InputStream, buf: ByteArray, from: Int = 0): Int {
    var got = from
    while (got < buf.size) {
      val n = input.read(buf, got, buf.size - got)
      if (n < 0) break
      got += n
    }
    return got
  }

  // Ciphertext bytes [start, end) of a file of `size` plaintext bytes, written to `out`. Only the
  // chunks that cover the range are encrypted, so a part can start anywhere (resume).
  // `open` gives a fresh stream of the plaintext each call.
  fun encryptRange(fk: ByteArray, size: Long, open: () -> InputStream, start: Long, end: Long, out: OutputStream) {
    val to = minOf(end, cipherSize(size))
    if (start >= to) return
    val first = start / CIPHER_CHUNK
    val lastIndex = chunkCount(size) - 1
    open().use { input ->
      var skipped = 0L
      while (skipped < first * CHUNK) {
        val n = input.skip(first * CHUNK - skipped)
        if (n <= 0) throw IOException("Couldn't skip ahead in the file")
        skipped += n
      }
      var i = first
      while (i * CIPHER_CHUNK < to) {
        val pt = ByteArray(minOf(CHUNK.toLong(), size - i * CHUNK).toInt())
        if (readFully(input, pt) < pt.size) throw Refused(0, "This file changed or got shorter while it was uploading. Try again.")
        val ct = encryptChunk(fk, i, i == lastIndex, pt)
        val base = i * CIPHER_CHUNK
        val a = maxOf(start - base, 0).toInt()
        val b = minOf(to - base, ct.size.toLong()).toInt()
        out.write(ct, a, b - a)
        i++
      }
    }
  }

  // Plaintext from a ciphertext stream. The last chunk is whatever is left at the end, so a stream
  // cut on a chunk boundary still fails (the chunk before it wasn't sealed as last).
  // `progress` hears the plaintext bytes written so far, after each chunk.
  fun decryptStream(fk: ByteArray, input: InputStream, out: OutputStream, progress: (Long) -> Unit = {}) {
    val buf = ByteArray(CIPHER_CHUNK + 1)
    var index = 0L
    var done = 0L
    var held = readFully(input, buf)
    while (held > CIPHER_CHUNK) {
      val pt = decryptChunk(fk, index++, false, buf, CIPHER_CHUNK)
      out.write(pt)
      done += pt.size
      progress(done)
      buf[0] = buf[CIPHER_CHUNK]
      held = readFully(input, buf, 1)
    }
    if (held == 0) throw IOException("vault file is truncated")
    val pt = decryptChunk(fk, index, true, buf, held)
    out.write(pt)
    progress(done + pt.size)
  }
}
