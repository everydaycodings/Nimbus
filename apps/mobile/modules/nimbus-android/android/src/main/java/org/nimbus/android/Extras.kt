package org.nimbus.android

import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.security.MessageDigest

// Quick Settings: pause or resume camera backup. Before backup is set up, a tap opens its settings.
class BackupTile : TileService() {
  override fun onStartListening() {
    val tile = qsTile ?: return
    val s = Backup.settings(this)
    val setUp = s.optString("accountId").isNotEmpty()
    val on = s.optBoolean("enabled")
    tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = "Camera backup"
    if (Build.VERSION.SDK_INT >= 29) tile.subtitle = if (!setUp) "Set up" else if (on) "On" else "Paused"
    tile.icon = Icon.createWithResource(this, R.drawable.ic_stat_nimbus)
    tile.updateTile()
  }

  override fun onClick() = if (isLocked) unlockAndRun(::toggle) else toggle()

  private fun toggle() {
    val s = Backup.settings(this)
    if (s.optString("accountId").isEmpty()) return openBackup()
    Backup.save(this, s.put("enabled", !s.optBoolean("enabled")).toString())
    onStartListening()
  }

  @Suppress("DEPRECATION")
  private fun openBackup() {
    val view = Intent(Intent.ACTION_VIEW, Uri.parse("nimbus://quick?do=backup")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 0, view, PendingIntent.FLAG_IMMUTABLE))
    else startActivityAndCollapse(view)
  }

  companion object {
    fun refresh(c: Context) = runCatching { requestListeningState(c, ComponentName(c, BackupTile::class.java)) }
  }
}

// Long-pressing the tile lands here; the app's backup settings take over.
class TileSettings : Activity() {
  override fun onCreate(saved: Bundle?) {
    super.onCreate(saved)
    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("nimbus://quick?do=backup")).setPackage(packageName))
    finish()
  }
}

// Direct share: folders recently saved into show in Android's share sheet. The shortcut's id is all a share
// brings back (EXTRA_SHORTCUT_ID), so the account and folder behind each id are kept here.
object ShareTargets {
  private const val PREFS = "nimbus_share_targets"
  // Must match the category in res/xml/nimbus_shortcuts.xml.
  private const val CATEGORY = "org.nimbus.drive.category.SAVE_TO_FOLDER"
  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun idOf(account: String, folder: String?) =
    "f-" + MessageDigest.getInstance("SHA-256").digest("$account\n${folder ?: ""}".toByteArray()).take(12).joinToString("") { "%02x".format(it) }

  fun push(c: Context, account: String, folder: String?, name: String) {
    val id = idOf(account, folder)
    prefs(c).edit().putString(id, JSONObject().put("accountId", account).put("folderId", folder ?: JSONObject.NULL).put("name", name).toString()).apply()
    // Tapped from the launcher's menu instead, it opens the folder.
    val open = if (folder == null) "nimbus://quick?do=home"
      else Uri.Builder().scheme("nimbus").authority("open-notification").appendQueryParameter("account", account)
        .appendQueryParameter("kind", "widget").appendQueryParameter("href", "").appendQueryParameter("node", folder).build().toString()
    val shortcut = ShortcutInfoCompat.Builder(c, id)
      .setShortLabel(name)
      .setLongLived(true)
      .setCategories(setOf(CATEGORY))
      .setIcon(IconCompat.createWithResource(c, R.drawable.ic_shortcut_folder))
      .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse(open)).setPackage(c.packageName))
      .build()
    runCatching { ShortcutManagerCompat.pushDynamicShortcut(c, shortcut) }
  }

  // JSON {accountId, folderId, name}, or null for a share that didn't come through one of ours.
  fun lookup(c: Context, id: String?): String? = id?.let { prefs(c).getString(it, null) }

  // Signed-out accounts' folders leave the share sheet.
  fun prune(c: Context) {
    val live = Accounts.all(c).map { it.id }.toSet()
    val gone = prefs(c).all.filter { (_, v) -> JSONObject(v as String).getString("accountId") !in live }.keys.toList()
    if (gone.isEmpty()) return
    runCatching { ShortcutManagerCompat.removeLongLivedShortcuts(c, gone) }
    prefs(c).edit().apply { gone.forEach { remove(it) } }.apply()
  }
}
