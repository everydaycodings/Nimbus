package org.nimbus.android

// Pure rules for the Files app integration, kept free of Android types so JUnit can run them.
object DocIds {
  data class Id(val account: String, val item: String)

  const val ROOT = "root"
  const val SHARED = "shared"
  const val STARRED = "starred"
  const val RECENT = "recent"
  val virtual = setOf(ROOT, SHARED, STARRED, RECENT)

  fun format(account: String, item: String) = "$account:$item"

  // "<account>:<item>". Account ids hold colons ("http://host:3000|user"); item ids never do, so the last one splits them.
  fun parse(doc: String): Id? {
    val i = doc.lastIndexOf(':')
    return if (i <= 0 || i == doc.length - 1) null else Id(doc.substring(0, i), doc.substring(i + 1))
  }

  // "report.docx" becomes "report (conflict).docx"; a leading dot or no dot has no extension.
  fun conflictName(name: String): String {
    val dot = name.lastIndexOf('.')
    return if (dot <= 0) "$name (conflict)" else name.substring(0, dot) + " (conflict)" + name.substring(dot)
  }
}

object LockRule {
  // A null timeout means the app lock is off. Otherwise the roots hide after lockNow or once the unlock is too old.
  fun hidden(locked: Boolean, unlockedAt: Long, timeout: Long?, now: Long) =
    timeout != null && (locked || now - unlockedAt > timeout)
}
