package org.nimbus.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

class MemoriesRulesTest {
  private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int) = Calendar.getInstance().apply { clear(); set(y, mo - 1, d, h, mi, 0) }
  private val hour = 3_600_000L

  @Test fun theNoticeWaitsForTodaysTimeIfItIsAhead() {
    assertEquals(2 * hour, MemoriesRules.delayMs(at(2026, 11, 12, 7, 0), 9, 0))
  }

  @Test fun orTomorrowsOnceItHasPassed() {
    assertEquals(23 * hour, MemoriesRules.delayMs(at(2026, 11, 12, 10, 0), 9, 0))
    assertEquals(24 * hour, MemoriesRules.delayMs(at(2026, 11, 12, 9, 0), 9, 0))
  }

  @Test fun theDateIsTheServersFormat() {
    assertEquals("2026-01-05", MemoriesRules.date(at(2026, 1, 5, 12, 0)))
  }

  @Test fun noPhotosMeansNoNotice() {
    assertNull(MemoriesRules.parse(JSONObject("""{"date":"2026-11-12","years":[]}""")))
    assertNull(MemoriesRules.parse(JSONObject("""{"date":"2026-11-12","years":[{"year":2025,"yearsAgo":1,"items":[]}]}""")))
  }

  @Test fun theTextNamesHowLongAgo() {
    val one = MemoriesRules.parse(JSONObject("""{"years":[{"yearsAgo":1,"items":[{},{}]}]}"""))!!
    assertEquals("2 photos from 1 year ago", MemoriesRules.text(one))
    val many = MemoriesRules.parse(JSONObject("""{"years":[{"yearsAgo":4,"items":[{}]},{"yearsAgo":2,"items":[{}]},{"yearsAgo":7,"items":[{}]}]}"""))!!
    assertEquals("3 photos from 2, 4 and 7 years ago", MemoriesRules.text(many))
  }
}
