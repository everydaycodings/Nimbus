package org.nimbus.android

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

// Open vault keys, in memory only and never handed to JS. Locking zeroes them and deletes the
// decrypted temp files kept for the vault.
object VaultKeys {
  private val open = ConcurrentHashMap<String, ByteArray>()
  // A vault just made on the phone, until the server has given it an id.
  private val pending = ConcurrentHashMap<String, ByteArray>()

  private const val SEP = "\u0001"
  fun scope(account: String, vault: String) = "$account$SEP$vault"

  fun hash(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)

  fun get(account: String, vault: String): ByteArray? = open[scope(account, vault)]
  fun isOpen(account: String, vault: String) = open.containsKey(scope(account, vault))
  fun put(account: String, vault: String, vk: ByteArray) {
    open.put(scope(account, vault), vk)?.fill(0)
  }

  fun hold(vk: ByteArray) = UUID.randomUUID().toString().also { pending[it] = vk }
  fun adopt(handle: String, account: String, vault: String): Boolean {
    put(account, vault, pending.remove(handle) ?: return false)
    return true
  }

  private fun root(context: Context) = File(context.cacheDir, "vault")

  fun cacheDir(context: Context, account: String, vault: String) =
    File(root(context), hash(account) + "/" + vault.replace(Regex("[^A-Za-z0-9_-]"), "_")).also { it.mkdirs() }

  fun lock(context: Context, account: String, vault: String) {
    val s = scope(account, vault)
    VaultFiles.cancelScope(s)
    open.remove(s)?.fill(0)
    cacheDir(context, account, vault).deleteRecursively()
  }

  // Null: every account.
  fun lockAll(context: Context, account: String?) {
    val prefix = account?.let { "$it$SEP" } ?: ""
    VaultFiles.cancelScope(prefix)
    open.keys.filter { it.startsWith(prefix) }.forEach { open.remove(it)?.fill(0) }
    pending.keys.toList().forEach { pending.remove(it)?.fill(0) }
    (if (account == null) root(context) else File(root(context), hash(account))).deleteRecursively()
  }

  fun wipeCache(context: Context) {
    root(context).deleteRecursively()
  }
}
