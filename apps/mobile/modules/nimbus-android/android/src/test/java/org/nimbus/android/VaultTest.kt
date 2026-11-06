package org.nimbus.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.Normalizer

// Vectors come from packages/shared/scripts/vault-vectors.ts, made by the web code.
class VaultTest {
  private val v = JSONObject(res("vault-vectors.json").toString(Charsets.UTF_8))
  private val vk = Vault.unb64(v.getJSONObject("vault").getString("vk"))
  private val file = v.getJSONObject("file")
  private val fk = Vault.unb64(file.getString("fk"))
  private val size = file.getLong("size")
  // Encryption is deterministic (fixed key, nonce = chunk index), so matching the web's length and hash
  // proves this is the web's ciphertext without keeping 10 MB in git.
  private val webCipher by lazy {
    encrypt(pattern(size)).also {
      assertEquals(file.getLong("cipherLength"), it.size.toLong())
      assertEquals(file.getString("cipherSha256"), java.security.MessageDigest.getInstance("SHA-256").digest(it).joinToString("") { b -> "%02x".format(b) })
    }
  }

  private fun res(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.use { it.readBytes() }
  private fun pattern(n: Long) = ByteArray(n.toInt()) { i -> ((i * 131L + (i ushr 8) * 7 + (i ushr 16) * 13) and 255).toByte() }
  private fun decrypt(ct: ByteArray) = ByteArrayOutputStream().also { Vault.decryptStream(fk, ByteArrayInputStream(ct), it) }.toByteArray()
  private fun encrypt(pt: ByteArray, key: ByteArray = fk, from: Long = 0, to: Long = Long.MAX_VALUE) =
    ByteArrayOutputStream().also { Vault.encryptRange(key, pt.size.toLong(), { ByteArrayInputStream(pt) }, from, to, it) }.toByteArray()
  private fun fails(body: () -> Unit) { try { body(); fail("should not open") } catch (_: java.security.GeneralSecurityException) {} catch (_: java.io.IOException) {} }
  private fun keys() = v.getJSONObject("vault").getJSONObject("keys")
  private fun kdf(o: JSONObject) = o.getInt("t") to o.getInt("m")

  @Test fun argon2MatchesWeb() {
    val k = v.getJSONObject("kdf")
    for (name in listOf("fast", "real")) {
      val c = k.getJSONObject(name)
      // The web normalises to NFC; so must we, whatever form the caller typed.
      val pass = Normalizer.normalize(k.getString("password"), Normalizer.Form.NFD)
      assertEquals(name, c.getString("out"), Vault.b64(Vault.passphraseKey(pass, k.getString("salt"), c.getInt("t"), c.getInt("m"))))
    }
  }

  @Test fun opensTheWebsVault() {
    val v = v.getJSONObject("vault")
    val k = keys()
    val (t, m) = kdf(k.getJSONObject("kdf"))
    val nfd = Normalizer.normalize(v.getString("passphrase"), Normalizer.Form.NFD)
    assertArrayEquals(vk, Vault.unlockWithPassphrase(k.getString("salt"), k.getString("wrapped"), t, m, nfd))
    // Lowercase, no dashes, stray spaces: still the same code.
    val code = v.getString("recoveryCode").lowercase().replace("-", " ")
    assertArrayEquals(vk, Vault.unlockWithRecovery(k.getString("recoveryWrapped"), code))
  }

  @Test fun wrongSecretsAreRefused() {
    val k = keys()
    fails { Vault.unlockWithPassphrase(k.getString("salt"), k.getString("wrapped"), 1, 1024, "not it") }
    fails { Vault.unlockWithRecovery(k.getString("recoveryWrapped"), Vault.recoveryCode(ByteArray(32))) }
    try { Vault.unlockWithRecovery(k.getString("recoveryWrapped"), "ABCD"); fail() } catch (_: IllegalArgumentException) {}
  }

  @Test fun recoveryCodeRoundTrips() {
    val bytes = Vault.random(32)
    assertArrayEquals(bytes, Vault.recoveryBytes(Vault.recoveryCode(bytes)))
    assertEquals(64, Vault.recoveryCode(bytes).length) // 52 characters in 13 groups
  }

  @Test fun opensTheWebsNamesAndTags() {
    val names: JSONArray = v.getJSONArray("names")
    for (i in 0 until names.length()) {
      val n = names.getJSONObject(i)
      val (name, mime) = Vault.decName(vk, n.getString("sealed"))
      assertEquals(n.getString("n"), name)
      assertEquals(if (n.isNull("t")) null else n.getString("t"), mime)
    }
    val tags = v.getJSONArray("tags")
    for (i in 0 until tags.length()) tags.getJSONObject(i).let { assertEquals(it.getString("name"), it.getString("tag"), Vault.nameTag(vk, it.getString("name"))) }
    // NFC and NFD spellings, and any case, are one name.
    assertEquals(Vault.nameTag(vk, "Résumé.DOCX"), Vault.nameTag(vk, Normalizer.normalize("résumé.docx", Normalizer.Form.NFD)))
  }

  @Test fun opensTheWebsFileKey() {
    assertArrayEquals(fk, Vault.openFileKey(vk, file.getString("wrapped")))
    fails { Vault.openFileKey(Vault.random(32), file.getString("wrapped")) }
  }

  @Test fun decryptsTheWebsFile() {
    assertEquals(Vault.cipherSize(size), webCipher.size.toLong())
    assertEquals(size, Vault.plainSize(webCipher.size.toLong()))
    assertArrayEquals(pattern(size), decrypt(webCipher))
    assertEquals(0, decrypt(Vault.unb64(file.getString("empty"))).size)
    assertArrayEquals(pattern(13), decrypt(Vault.unb64(file.getJSONObject("tiny").getString("cipher"))))
  }

  @Test fun encryptsByteForByteLikeTheWeb() {
    val pt = pattern(size)
    assertArrayEquals(webCipher, encrypt(pt))
    // Parts that start and stop anywhere, as a resumed upload does.
    for ((a, b) in listOf(0L to 1L, 100L to Vault.CIPHER_CHUNK + 50L, Vault.CIPHER_CHUNK.toLong() to 2L * Vault.CIPHER_CHUNK, 2L * Vault.CIPHER_CHUNK + 7 to webCipher.size.toLong(), 5L to 5L))
      assertArrayEquals("$a-$b", webCipher.copyOfRange(a.toInt(), b.toInt()), encrypt(pt, from = a, to = b))
    assertArrayEquals(Vault.unb64(file.getString("empty")), encrypt(ByteArray(0)))
  }

  @Test fun whatKotlinSealsOpensAgain() {
    val c = Vault.newVault("pässword", 1, 1024)
    assertArrayEquals(c.vk, Vault.unlockWithPassphrase(c.salt, c.wrapped, c.t, c.m, "pässword"))
    assertArrayEquals(c.vk, Vault.unlockWithRecovery(c.recoveryWrapped, c.recoveryCode))
    val w = Vault.rewrap(c.vk, "another one", 1, 1024)
    assertArrayEquals(c.vk, Vault.unlockWithPassphrase(w.salt, w.wrapped, w.t, w.m, "another one"))
    assertEquals("Ünï 🙂.txt" to null, Vault.decName(c.vk, Vault.encName(c.vk, "Ünï 🙂.txt", null)))
    assertEquals("a.pdf" to "application/pdf", Vault.decName(c.vk, Vault.encName(c.vk, "a.pdf", "application/pdf")))
    val (key, wrapped) = Vault.newFileKey(c.vk)
    assertArrayEquals(key, Vault.openFileKey(c.vk, wrapped))
    val pt = pattern(1000)
    assertArrayEquals(pt, ByteArrayOutputStream().also { Vault.decryptStream(key, ByteArrayInputStream(encrypt(pt, key)), it) }.toByteArray())
  }

  @Test fun tamperedReorderedOrTruncatedFileFails() {
    val cc = Vault.CIPHER_CHUNK
    val flipped = webCipher.clone().also { it[cc + 5] = (it[cc + 5].toInt() xor 1).toByte() }
    fails { decrypt(flipped) }
    // Chunks 0 and 1 swapped: each was sealed for its own place.
    val swapped = webCipher.clone()
    System.arraycopy(webCipher, cc, swapped, 0, cc)
    System.arraycopy(webCipher, 0, swapped, cc, cc)
    fails { decrypt(swapped) }
    // Cut on a chunk boundary (the chunk before wasn't sealed as last), and mid-chunk, and to nothing.
    fails { decrypt(webCipher.copyOf(2 * cc)) }
    fails { decrypt(webCipher.copyOf(webCipher.size - 1)) }
    fails { decrypt(ByteArray(0)) }
    // Another file's key.
    fails { Vault.decryptStream(Vault.random(32), ByteArrayInputStream(webCipher), ByteArrayOutputStream()) }
  }

  @Test fun sizesRoundTrip() {
    for (n in listOf(0L, 1L, Vault.CHUNK - 1L, Vault.CHUNK.toLong(), Vault.CHUNK + 1L, 3L * Vault.CHUNK)) assertEquals(n, Vault.plainSize(Vault.cipherSize(n)))
    assertEquals(16L, Vault.cipherSize(0))
  }
}
