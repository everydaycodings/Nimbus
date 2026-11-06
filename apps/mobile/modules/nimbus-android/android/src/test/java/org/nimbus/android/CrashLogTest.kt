package org.nimbus.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashLogTest {
  @Test
  fun `a crash names the time, the thread and the stack`() {
    val text = CrashLog.format(0L, "main", IllegalStateException("boom"))
    assertTrue(text.startsWith("time: 1970-01-01T00:00:00Z\nthread: main\n"))
    assertTrue(text.contains("java.lang.IllegalStateException: boom"))
  }

  @Test
  fun `a deep stack is cut`() {
    fun deep(n: Int): Nothing = if (n == 0) throw RuntimeException("x".repeat(40_000)) else deep(n - 1)
    val e = try { deep(50) } catch (e: RuntimeException) { e }
    val text = CrashLog.format(0L, "t", e)
    assertEquals(true, text.length < 17_000)
  }
}
