package org.nimbus.android

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG

// An AES key that never leaves Android's keystore. With `auth`, every use needs a strong biometric
// (a CryptoObject), and a new fingerprint enrolment kills it.
private fun keystoreKey(alias: String, auth: Boolean): SecretKey {
  val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
  val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
  if (auth) {
    spec.setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true)
    if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
    else @Suppress("DEPRECATION") spec.setUserAuthenticationValidityDurationSeconds(-1)
  }
  return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
}

// File keys of queued vault uploads, so the worker can carry on with the vault locked or the app closed.
// Sealed with a key that needs no unlock; a row's copy is deleted when its upload ends.
object JobKey {
  private const val ALIAS = "nimbus_vault_jobs"

  fun seal(fk: ByteArray): String {
    val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, keystoreKey(ALIAS, false)) }
    return Vault.b64(c.iv + c.doFinal(fk))
  }

  // Null when the keystore can't open it (restored backup, wiped key).
  fun open(sealed: String): ByteArray? = try {
    val b = Vault.unb64(sealed)
    Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, keystoreKey(ALIAS, false), GCMParameterSpec(128, b, 0, 12)) }.doFinal(b, 12, b.size - 12)
  } catch (_: GeneralSecurityException) { null }
}

// Fingerprint unlock: the vault key sealed under a biometric-gated keystore key, per account and vault.
object VaultBio {
  private const val PREFS = "nimbus_vault_bio"
  private val CANCELLED = setOf(BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED)

  private fun id(account: String, vault: String) = VaultKeys.hash(account) + ":" + vault
  private fun alias(id: String) = "nimbus_vbio_" + VaultKeys.hash(id)
  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun available(context: Context) = BiometricManager.from(context).canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS
  fun enabled(context: Context, account: String, vault: String) = prefs(context).contains(id(account, vault))

  private fun drop(context: Context, id: String) {
    prefs(context).edit().remove(id).apply()
    runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias(id)) }
  }

  fun disable(context: Context, account: String, vault: String) = drop(context, id(account, vault))
  fun dropAccount(context: Context, account: String) {
    val prefix = VaultKeys.hash(account) + ":"
    prefs(context).all.keys.filter { it.startsWith(prefix) }.forEach { drop(context, it) }
  }

  // `done` gets the authenticated cipher, or null when the person backed out.
  private fun prompt(activity: FragmentActivity, title: String, cipher: Cipher, promise: Promise, done: (Cipher?) -> Unit) {
    activity.runOnUiThread {
      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          try { done(result.cryptoObject?.cipher) } catch (e: Exception) { promise.reject(CodedException(e.message ?: "Fingerprint unlock failed.")) }
        }
        override fun onAuthenticationError(code: Int, message: CharSequence) {
          if (code in CANCELLED) done(null) else promise.reject(CodedException(message.toString()))
        }
      }
      val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setNegativeButtonText("Cancel").setAllowedAuthenticators(AUTH).build()
      BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
  }

  fun enable(activity: Activity?, account: String, vault: String, promise: Promise) {
    val fa = activity as? FragmentActivity ?: return promise.reject(CodedException("Fingerprint unlock isn't available here."))
    val vk = VaultKeys.get(account, vault) ?: return promise.reject(CodedException("Unlock the vault first."))
    val ctx = fa.applicationContext
    val id = id(account, vault)
    drop(ctx, id) // a fresh key every time, so a stale one can't linger
    val cipher = try {
      Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, keystoreKey(alias(id), true)) }
    } catch (e: GeneralSecurityException) { return promise.reject(CodedException("Fingerprint unlock isn't available here.")) }
    prompt(fa, "Turn on fingerprint unlock", cipher, promise) { c ->
      if (c == null) { drop(ctx, id); promise.resolve("cancel"); return@prompt }
      prefs(ctx).edit().putString(id, Vault.b64(c.iv + c.doFinal(vk))).apply()
      promise.resolve("ok")
    }
  }

  fun unlock(activity: Activity?, account: String, vault: String, promise: Promise) {
    val fa = activity as? FragmentActivity ?: return promise.reject(CodedException("Fingerprint unlock isn't available here."))
    val ctx = fa.applicationContext
    val id = id(account, vault)
    val sealed = prefs(ctx).getString(id, null)?.let { Vault.unb64(it) } ?: return promise.resolve("none")
    val cipher = try {
      Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, keystoreKey(alias(id), true), GCMParameterSpec(128, sealed, 0, 12)) }
    } catch (e: KeyPermanentlyInvalidatedException) {
      drop(ctx, id); return promise.resolve("invalidated")
    } catch (e: GeneralSecurityException) {
      drop(ctx, id); return promise.resolve("invalidated")
    }
    prompt(fa, "Unlock vault", cipher, promise) { c ->
      if (c == null) { promise.resolve("cancel"); return@prompt }
      val vk = try { c.doFinal(sealed, 12, sealed.size - 12) } catch (e: GeneralSecurityException) { drop(ctx, id); promise.resolve("invalidated"); return@prompt }
      VaultKeys.put(account, vault, vk)
      promise.resolve("ok")
    }
  }
}
