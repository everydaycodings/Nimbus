package org.nimbus.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The app's sign-ins, mirrored from JS so workers can call the server while the app is closed.
// Encrypted with a key that never leaves Android's keystore.
object Accounts {
  data class Account(val id: String, val server: String, val token: String)

  private const val ALIAS = "nimbus_accounts"
  private const val PREFS = "nimbus_accounts"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build()
    )
    return gen.generateKey()
  }

  fun save(context: Context, json: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.iv + cipher.doFinal(json.toByteArray())
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("v1", Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
  }

  fun all(context: Context): List<Account> {
    val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("v1", null) ?: return emptyList()
    return try {
      val sealed = Base64.decode(stored, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
      val list = JSONArray(String(cipher.doFinal(sealed, 12, sealed.size - 12)))
      (0 until list.length()).map { list.getJSONObject(it) }.map { Account(it.getString("id"), it.getString("server"), it.getString("token")) }
    } catch (e: Exception) {
      emptyList() // A restored backup can't open another phone's key; JS sends the accounts again at start.
    }
  }

  fun get(context: Context, id: String) = all(context).firstOrNull { it.id == id }
}
