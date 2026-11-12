// The pure parts of Restore to a point in time. No imports, so node --test can run it.

export const UNDO_DAYS = 7
export const undoable = (createdAt: number, undoneAt: unknown, now = Date.now()) =>
  !undoneAt && now - createdAt < UNDO_DAYS * 86_400_000

// A rename or move from the activity log. fromName is set on every row written since phase 17
// (a move keeps the name it had), so null means the row predates it and says nothing.
export type Hist = {
  nodeId: string
  type: "rename" | "move"
  at: number
  fromName: string | null
  fromParentId: string | null
}

export type Earliest = {
  /** Name at the time, per node. */
  names: Map<string, string>
  /** Parent at the time (null: the root), per node. */
  parents: Map<string, string | null>
  /** Nodes whose first change after the time wasn't tracked, so there's nothing to go back to. */
  untracked: Set<string>
}

// What each node looked like at `at`: the earliest rename and the earliest move after it say.
export function earliestAfter(events: Hist[], at: number): Earliest {
  const first = new Map<string, Hist>()
  for (const e of events) {
    if (e.at <= at) continue
    const k = `${e.type}:${e.nodeId}`
    const was = first.get(k)
    if (!was || e.at < was.at) first.set(k, e)
  }
  const out: Earliest = { names: new Map(), parents: new Map(), untracked: new Set() }
  for (const e of first.values()) {
    if (e.fromName === null) out.untracked.add(e.nodeId)
    else if (e.type === "rename") out.names.set(e.nodeId, e.fromName)
    else out.parents.set(e.nodeId, e.fromParentId)
  }
  return out
}

// "report.pdf" -> "report (restored).pdf", then "report (restored 2).pdf", until `taken`
// (lowercase names in the folder) has no clash. Folders have no extension.
export function restoredName(name: string, taken: Set<string>, folder = false) {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 1; ; n++) {
    const next = `${stem} (restored${n > 1 ? ` ${n}` : ""})${ext}`
    if (!taken.has(next.toLowerCase())) return next
  }
}
