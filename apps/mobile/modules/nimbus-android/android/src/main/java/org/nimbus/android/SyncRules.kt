package org.nimbus.android

// Folder sync's decisions, free of Android so a plain JUnit test can run them.
// A side is the file's SHA-256 (any stable stamp will do), or null when the file isn't there.
object SyncRules {
  enum class Kind {
    NOOP,
    UPLOAD, // phone -> server; a new file, or a new version when the server has one at that path
    DOWNLOAD, // server -> phone
    CONFLICT, // both changed: the phone's goes up beside the server's, then the server's comes down over it
    DELETE_REMOTE, // to the server's Trash
    DELETE_LOCAL,
    ADOPT, // both already agree: just remember it
    FORGET, // gone from both sides
  }

  fun decide(local: String?, remote: String?, base: String?, twoWay: Boolean): Kind {
    // One-way never reads the server and never deletes: a new or changed phone file goes up.
    if (!twoWay) return if (local == null || local == base) Kind.NOOP else Kind.UPLOAD
    return when {
      local == null && remote == null -> if (base != null) Kind.FORGET else Kind.NOOP
      remote == null -> when (base) {
        local -> Kind.DELETE_LOCAL // the server's copy was deleted and the phone's never changed
        else -> Kind.UPLOAD // new here, or changed here after the server's was deleted: a change beats a delete
      }
      local == null -> if (base == remote) Kind.DELETE_REMOTE else Kind.DOWNLOAD
      local == remote -> if (base == local) Kind.NOOP else Kind.ADOPT
      base == null -> Kind.CONFLICT
      local == base -> Kind.DOWNLOAD
      remote == base -> Kind.UPLOAD
      else -> Kind.CONFLICT
    }
  }

  data class Action(val path: String, val kind: Kind, val conflictPath: String? = null)

  // Everything to do for one pair, in path order. `broken`: phone files a failed download may have cut short;
  // they're replaced from the server and never trusted as changes.
  fun plan(
    local: Map<String, String>,
    remote: Map<String, String>,
    base: Map<String, String>,
    twoWay: Boolean,
    device: String,
    broken: Set<String> = emptySet(),
  ): List<Action> {
    val taken = (local.keys + remote.keys).map { it.lowercase() }.toMutableSet()
    val out = ArrayList<Action>()
    for (path in (local.keys + remote.keys + base.keys).toSortedSet()) {
      val r = remote[path]
      val kind = if (twoWay && path in broken && r != null) Kind.DOWNLOAD else decide(local[path], r, base[path], twoWay)
      if (kind == Kind.NOOP) continue
      out += if (kind == Kind.CONFLICT) {
        val beside = conflictPath(path, device, taken)
        taken += beside.lowercase()
        Action(path, kind, beside)
      } else Action(path, kind)
    }
    return out
  }

  // "docs/report.docx" -> "docs/report (conflict, Pixel 8).docx"; a second one for the same path adds a number.
  fun conflictPath(path: String, device: String, taken: Set<String>): String {
    val dir = path.substringBeforeLast('/', "")
    val name = path.substringAfterLast('/')
    val dot = name.lastIndexOf('.')
    val stem = if (dot <= 0) name else name.substring(0, dot)
    val ext = if (dot <= 0) "" else name.substring(dot)
    val who = device.replace(Regex("[/\\\\\u0000-\u001f]"), "_").trim().ifEmpty { "phone" }.take(40)
    var n = 1
    while (true) {
      val label = if (n == 1) "conflict, $who" else "conflict, $who, $n"
      val candidate = (if (dir.isEmpty()) "" else "$dir/") + "$stem ($label)$ext"
      if (candidate.lowercase() !in taken) return candidate
      n++
    }
  }

  // Many deletions at once usually mean a folder that wasn't read properly (a card pulled out, a whole
  // folder trashed), not a clean-up: stop and ask. Sync now confirms.
  fun massDelete(actions: List<Action>, tracked: Int): Boolean {
    val limit = maxOf(10, tracked / 2)
    return actions.count { it.kind == Kind.DELETE_LOCAL } > limit || actions.count { it.kind == Kind.DELETE_REMOTE } > limit
  }
}
