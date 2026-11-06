package org.nimbus.android

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/** Keeps the last uncaught exception in a file on this phone, for the next launch to offer in a report. Nothing leaves the device. */
object CrashLog {
  private const val FILE = "last-crash.txt"
  private const val MAX = 16_000
  private var installed = false

  /** Formats one crash. The stack is cut to MAX characters so a deep trace can't fill the disk. */
  fun format(at: Long, thread: String, e: Throwable): String {
    val sw = StringWriter()
    e.printStackTrace(PrintWriter(sw))
    return "time: ${java.time.Instant.ofEpochMilli(at)}\nthread: $thread\n${sw.toString().take(MAX)}"
  }

  /** Records the crash, then hands it to whoever was there before (Android's own handler, which ends the process). */
  fun install(context: Context) {
    if (installed) return
    installed = true
    val dir = context.applicationContext.filesDir
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { t, e ->
      try {
        // Overwrites: only the last one is kept.
        File(dir, FILE).writeText(format(System.currentTimeMillis(), t.name, e))
      } catch (_: Throwable) {
      }
      previous?.uncaughtException(t, e)
    }
  }

  fun read(context: Context): String? = File(context.filesDir, FILE).takeIf { it.isFile }?.readText()

  fun clear(context: Context) {
    File(context.filesDir, FILE).delete()
  }
}
