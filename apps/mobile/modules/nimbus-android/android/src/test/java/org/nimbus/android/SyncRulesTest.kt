package org.nimbus.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.nimbus.android.SyncRules.Kind

class SyncRulesTest {
  private fun d(local: String?, remote: String?, base: String?) = SyncRules.decide(local, remote, base, twoWay = true)

  @Test fun nothingChangedDoesNothing() {
    assertEquals(Kind.NOOP, d("a", "a", "a"))
    assertEquals(Kind.NOOP, d(null, null, null))
  }

  @Test fun aChangeOnOneSideCopiesAcross() {
    assertEquals(Kind.UPLOAD, d("b", "a", "a"))
    assertEquals(Kind.DOWNLOAD, d("a", "b", "a"))
    assertEquals(Kind.UPLOAD, d("a", null, null))
    assertEquals(Kind.DOWNLOAD, d(null, "a", null))
  }

  @Test fun changesOnBothSidesAreAConflictUnlessTheyAgree() {
    assertEquals(Kind.CONFLICT, d("b", "c", "a"))
    assertEquals(Kind.CONFLICT, d("b", "c", null))
    assertEquals(Kind.ADOPT, d("b", "b", "a"))
    assertEquals(Kind.ADOPT, d("b", "b", null))
  }

  @Test fun aDeleteFollowsOnlyWhenTheOtherSideIsUntouched() {
    assertEquals(Kind.DELETE_REMOTE, d(null, "a", "a"))
    assertEquals(Kind.DELETE_LOCAL, d("a", null, "a"))
    assertEquals(Kind.FORGET, d(null, null, "a"))
  }

  @Test fun aChangeBeatsADelete() {
    assertEquals(Kind.DOWNLOAD, d(null, "b", "a"))
    assertEquals(Kind.UPLOAD, d("b", null, "a"))
  }

  @Test fun oneWayOnlyEverUploads() {
    fun o(l: String?, r: String?, b: String?) = SyncRules.decide(l, r, b, twoWay = false)
    assertEquals(Kind.UPLOAD, o("a", null, null))
    assertEquals(Kind.UPLOAD, o("b", "a", "a"))
    assertEquals(Kind.NOOP, o("a", null, "a"))
    assertEquals(Kind.NOOP, o(null, "a", "a")) // deleted on the phone: the backup keeps it
    assertEquals(Kind.NOOP, o(null, null, "a"))
  }

  @Test fun conflictNamesKeepTheExtensionAndTheFolder() {
    assertEquals("docs/report (conflict, Pixel 8).docx", SyncRules.conflictPath("docs/report.docx", "Pixel 8", emptySet()))
    assertEquals("notes (conflict, Pixel 8)", SyncRules.conflictPath("notes", "Pixel 8", emptySet()))
    assertEquals(".env (conflict, Pixel 8)", SyncRules.conflictPath(".env", "Pixel 8", emptySet()))
    assertEquals("a.tar (conflict, Pixel 8).gz", SyncRules.conflictPath("a.tar.gz", "Pixel 8", emptySet()))
    assertEquals("a (conflict, a_b).txt", SyncRules.conflictPath("a.txt", "a/b", emptySet()))
    assertEquals("a (conflict, phone).txt", SyncRules.conflictPath("a.txt", " ", emptySet()))
  }

  @Test fun aTakenConflictNameGetsANumber() {
    val taken = setOf("a (conflict, p).txt")
    assertEquals("a (conflict, p, 2).txt", SyncRules.conflictPath("a.txt", "p", taken))
    assertEquals("a (conflict, p, 3).txt", SyncRules.conflictPath("a.txt", "p", taken + "a (conflict, p, 2).txt"))
    assertEquals("A (conflict, p, 2).txt", SyncRules.conflictPath("A.txt", "p", setOf("a (conflict, p).txt")))
  }

  @Test fun aPlanCoversEveryPathInOrderAndNamesConflicts() {
    val plan = SyncRules.plan(
      local = mapOf("same" to "1", "new" to "1", "both" to "L", "gone-remote" to "1"),
      remote = mapOf("same" to "1", "both" to "R", "added" to "1", "gone-local" to "1"),
      base = mapOf("same" to "1", "both" to "0", "gone-remote" to "1", "gone-local" to "1"),
      twoWay = true,
      device = "Pixel",
    )
    assertEquals(
      listOf(
        SyncRules.Action("added", Kind.DOWNLOAD),
        SyncRules.Action("both", Kind.CONFLICT, "both (conflict, Pixel)"),
        SyncRules.Action("gone-local", Kind.DELETE_REMOTE),
        SyncRules.Action("gone-remote", Kind.DELETE_LOCAL),
        SyncRules.Action("new", Kind.UPLOAD),
      ),
      plan
    )
  }

  @Test fun aConflictNameNeverLandsOnAnExistingFile() {
    val plan = SyncRules.plan(
      local = mapOf("a.txt" to "L"),
      remote = mapOf("a.txt" to "R", "a (conflict, P).txt" to "x"),
      base = mapOf("a.txt" to "0"),
      twoWay = true,
      device = "P",
    )
    assertEquals("a (conflict, P, 2).txt", plan.first { it.kind == Kind.CONFLICT }.conflictPath)
  }

  @Test fun aFileAFailedDownloadMayHaveCutShortIsReplacedNotUploaded() {
    val plan = SyncRules.plan(mapOf("a" to "cut"), mapOf("a" to "R"), mapOf("a" to "R"), twoWay = true, device = "P", broken = setOf("a"))
    assertEquals(listOf(SyncRules.Action("a", Kind.DOWNLOAD)), plan)
  }

  @Test fun manyDeletionsAtOnceAreHeldBack() {
    fun del(n: Int, kind: Kind) = (1..n).map { SyncRules.Action("f$it", kind) }
    assertFalse(SyncRules.massDelete(del(10, Kind.DELETE_REMOTE), 12))
    assertTrue(SyncRules.massDelete(del(11, Kind.DELETE_REMOTE), 12))
    assertFalse(SyncRules.massDelete(del(60, Kind.DELETE_LOCAL), 120))
    assertTrue(SyncRules.massDelete(del(61, Kind.DELETE_LOCAL), 120))
    assertFalse(SyncRules.massDelete(del(5, Kind.DELETE_LOCAL) + del(5, Kind.DELETE_REMOTE), 10))
  }
}
