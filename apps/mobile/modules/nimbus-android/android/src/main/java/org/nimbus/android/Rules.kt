package org.nimbus.android

import java.util.Calendar
import java.util.TimeZone

// Backup's decisions, kept free of Android so a plain JUnit test can run them.
object Rules {
  // What the server's `uploads/exists` said about one item.
  data class Match(val by: String, val sameSize: Boolean)

  enum class Decision { SKIP, UPLOAD }

  // Same bytes anywhere in My files, or the same name and size in the month folder: already there.
  // Anything else goes up, and always as a new file: a new phone's IMG_0001.jpg must never become
  // a version of an old photo with the same name.
  fun decide(match: Match?) = when {
    match == null -> Decision.UPLOAD
    match.by == "sha256" -> Decision.SKIP
    match.by == "name" && match.sameSize -> Decision.SKIP
    else -> Decision.UPLOAD
  }

  // Camera/YYYY/MM for the camera, Camera/<Album>/YYYY/MM for anything else, in the phone's time zone.
  fun folderFor(taken: Long, album: String?, zone: TimeZone = TimeZone.getDefault()): String {
    val cal = Calendar.getInstance(zone).apply { timeInMillis = taken }
    val month = "%02d".format(cal.get(Calendar.MONTH) + 1)
    val base = if (album == null) "Camera" else "Camera/${safe(album)}"
    return "$base/${cal.get(Calendar.YEAR)}/$month"
  }

  // Folder names can't hold a slash, a backslash or NUL, and can't be "." or "..".
  fun safe(name: String): String {
    val cleaned = name.replace(Regex("[/\\\\\u0000]"), "_").trim()
    return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "Album" else cleaned.take(255)
  }

  // When an item counts as taken: the camera's date, or else when the file last changed.
  fun takenAt(dateTaken: Long?, dateModifiedSeconds: Long) = dateTaken?.takeIf { it > 0 } ?: (dateModifiedSeconds * 1000)

  fun isCamera(relativePath: String?, bucket: String?) =
    relativePath?.startsWith("DCIM/Camera", ignoreCase = true) == true || bucket.equals("Camera", ignoreCase = true)
}
