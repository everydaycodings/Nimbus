package org.nimbus.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushRulesTest {
  private fun item(id: String, at: String, read: Boolean = false, kind: String = "shared") = PushRules.Item(id, kind, "t", "/x", at, read, null)

  @Test fun kindsGoToTheirChannels() {
    for (k in listOf("shared", "access_changed", "access_removed", "transfer", "album", "partner")) assertEquals(PushRules.SHARING, PushRules.channelFor(k))
    for (k in listOf("file_drop", "edits")) assertEquals(PushRules.DROPS, PushRules.channelFor(k))
    for (k in listOf("app_password", "storage_low", "signup_request", "service_health", "backup", "something_new")) assertEquals(PushRules.ACCOUNT, PushRules.channelFor(k))
  }

  @Test fun onlyUnreadNewerThanTheLastShownComeBackOldestFirst() {
    val items = listOf(item("c", "2026-11-06T12:00:00Z"), item("b", "2026-11-06T11:00:00Z"), item("a", "2026-11-06T10:00:00Z"), item("r", "2026-11-06T13:00:00Z", read = true))
    assertEquals(listOf("b", "c"), PushRules.fresh(items, "2026-11-06T10:00:00Z").map { it.id })
  }

  @Test fun nothingShownYetMeansOnlyTheNewestUnread() {
    val items = listOf(item("a", "2026-11-06T10:00:00Z"), item("b", "2026-11-06T11:00:00Z"))
    assertEquals(listOf("b"), PushRules.fresh(items, null).map { it.id })
  }

  @Test fun aBurstIsCappedToTheNewest() {
    val items = (1..9).map { item("i$it", "2026-11-06T10:0$it:00Z") }
    assertEquals(listOf("i7", "i8", "i9"), PushRules.fresh(items, "2026-11-06T09:00:00Z", 3).map { it.id })
  }

  @Test fun theServersListParses() {
    val body = JSONObject("""{"items":[{"id":"n1","kind":"shared","text":"Sam shared a file","href":"/f","read":false,"createdAt":"2026-11-06T10:00:00Z","nodeId":"abc"},{"id":"n2","kind":"backup","text":"Backup failed","href":"/admin","read":true,"createdAt":"2026-11-06T09:00:00Z","nodeId":null}],"unread":1,"shared":1}""")
    val items = PushRules.parse(body)
    assertEquals(2, items.size)
    assertEquals("abc", items[0].nodeId)
    assertNull(items[1].nodeId)
    assertEquals("2026-11-06T10:00:00Z", PushRules.newest(items))
  }
}
