package org.nimbus.android

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

class RulesTest {
  @Test fun sameBytesOrSameNameAndSizeAreSkipped() {
    assertEquals(Rules.Decision.SKIP, Rules.decide(Rules.Match("sha256", false)))
    assertEquals(Rules.Decision.SKIP, Rules.decide(Rules.Match("name", true)))
  }

  @Test fun aSameNameWithOtherBytesStillUploads() {
    assertEquals(Rules.Decision.UPLOAD, Rules.decide(Rules.Match("name", false)))
    assertEquals(Rules.Decision.UPLOAD, Rules.decide(null))
  }

  @Test fun monthFoldersUseThePhonesTimeZone() {
    val utc = TimeZone.getTimeZone("UTC")
    val kolkata = TimeZone.getTimeZone("Asia/Kolkata")
    // 2026-10-31 20:00 UTC is already November in India.
    val t = 1793476800000L
    assertEquals("Camera/2026/10", Rules.folderFor(t, null, utc))
    assertEquals("Camera/2026/11", Rules.folderFor(t, null, kolkata))
    assertEquals("Camera/Screenshots/2026/10", Rules.folderFor(t, "Screenshots", utc))
  }

  @Test fun albumNamesBecomeSafeFolderNames() {
    assertEquals("A_B", Rules.safe("A/B"))
    assertEquals("Album", Rules.safe(".."))
    assertEquals("Album", Rules.safe("  "))
  }

  @Test fun takenFallsBackToModified() {
    assertEquals(5000L, Rules.takenAt(null, 5))
    assertEquals(7L, Rules.takenAt(7, 5))
    assertEquals(5000L, Rules.takenAt(0, 5))
  }

  @Test fun cameraIsDcimCamera() {
    assertEquals(true, Rules.isCamera("DCIM/Camera/", "Camera"))
    assertEquals(true, Rules.isCamera(null, "Camera"))
    assertEquals(false, Rules.isCamera("Pictures/Screenshots/", "Screenshots"))
  }
}
