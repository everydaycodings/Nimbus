package org.nimbus.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DocsTest {
  @Test fun idsRoundTrip() {
    assertEquals("a1:i2", DocIds.format("a1", "i2"))
    assertEquals(DocIds.Id("a1", "i2"), DocIds.parse("a1:i2"))
    assertEquals(DocIds.Id("a1", "root"), DocIds.parse(DocIds.format("a1", DocIds.ROOT)))
  }

  @Test fun badIdsAreRefused() {
    val real = "http://192.168.0.108:3000|yuAhAUXVvTX6GJ87TiEhZRz3bsbF52pZ"
    assertEquals(DocIds.Id(real, "02deee97-a3d9-4fe1-bc6e-58c24475d0c6"), DocIds.parse(DocIds.format(real, "02deee97-a3d9-4fe1-bc6e-58c24475d0c6")))
    assertEquals(DocIds.Id(real, "starred"), DocIds.parse(DocIds.format(real, DocIds.STARRED)))
    assertNull(DocIds.parse("nocolon"))
    assertNull(DocIds.parse(":item"))
    assertNull(DocIds.parse("account:"))
  }

  @Test fun conflictNameKeepsTheExtension() {
    assertEquals("report (conflict).docx", DocIds.conflictName("report.docx"))
    assertEquals("notes (conflict)", DocIds.conflictName("notes"))
    assertEquals("a.b.c (conflict).txt", DocIds.conflictName("a.b.c.txt"))
    assertEquals(".env (conflict)", DocIds.conflictName(".env"))
  }

  @Test fun lockHidesRootsOnlyWhenOnAndStaleOrLocked() {
    assertFalse(LockRule.hidden(true, 0, null, 10_000))
    assertFalse(LockRule.hidden(false, 9_000, 5_000, 10_000))
    assertTrue(LockRule.hidden(false, 1_000, 5_000, 10_000))
    assertTrue(LockRule.hidden(true, 9_999, 5_000, 10_000))
  }
}
