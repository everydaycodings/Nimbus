package org.nimbus.android

import org.json.JSONObject

// Push's decisions, kept free of Android so a plain JUnit test can run them.
object PushRules {
  const val SHARING = "push-sharing"
  const val DROPS = "push-drops"
  const val ACCOUNT = "push-account"

  // The notification kinds of packages/shared/api.ts. Anything new lands under Account & security.
  fun channelFor(kind: String) = when (kind) {
    "shared", "access_changed", "access_removed", "transfer", "album", "partner" -> SHARING
    "file_drop", "edits" -> DROPS
    else -> ACCOUNT // app_password, storage_low, signup_request, service_health, backup
  }

  data class Item(val id: String, val kind: String, val text: String, val href: String, val createdAt: String, val read: Boolean, val nodeId: String?)

  // GET /api/v1/notifications.
  fun parse(body: JSONObject): List<Item> {
    val list = body.optJSONArray("items") ?: return emptyList()
    return (0 until list.length()).map { list.getJSONObject(it) }.map {
      Item(it.getString("id"), it.optString("kind"), it.optString("text"), it.optString("href"), it.optString("createdAt"), it.optBoolean("read"), if (it.isNull("nodeId")) null else it.getString("nodeId"))
    }
  }

  // Unread items newer than the last one shown, oldest first. createdAt is ISO 8601 in UTC, so text order is time order.
  // With nothing shown yet there's no telling what's old news, so only the newest unread one is.
  fun fresh(items: List<Item>, lastShown: String?, limit: Int = 5): List<Item> {
    val unread = items.filter { !it.read && (lastShown == null || it.createdAt > lastShown) }.sortedBy { it.createdAt }
    return unread.takeLast(if (lastShown == null) 1 else limit)
  }

  // The newest time among all items: what to remember as shown.
  fun newest(items: List<Item>) = items.maxOfOrNull { it.createdAt }
}
