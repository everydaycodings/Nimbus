// The rules behind offline files and the change queue. No React or native imports, so node --test can run them.
import type { DocOp } from "./documents-rules.ts"

const GB = 1024 ** 3
export const CAPS: (number | null)[] = [1 * GB, 2 * GB, 5 * GB, 10 * GB, 20 * GB, 50 * GB, null]
export const DEFAULT_CAP = 5 * GB

// ---- The queue ----

// What can wait for a connection. Sharing, links, versions, account changes and delete forever can't.
export type Op =
  | { op: "rename"; id: string; name: string; folder?: boolean; clashed?: boolean }
  | { op: "move"; ids: string[]; parentId: string | null }
  | { op: "star"; ids: string[]; starred: boolean }
  | { op: "trash"; ids: string[] }
  | { op: "restore"; ids: string[] }
  | { op: "newFolder"; parentId: string | null; name: string; tempId: string; clashed?: boolean }
  | { op: "applyTag"; ids: string[]; tagId: string; on: boolean }
  // An edited text file; `base` is the version it was opened at. Fails (Couldn't sync) if the server's has moved on.
  | { op: "saveText"; id: string; parentId: string | null; name: string; text: string; base: string | null }
  // An edited PDF waiting in the app's own folder (`uri`); same `base` rule as saveText, except a copy never clashes.
  | { op: "savePdf"; id: string; parentId: string | null; name: string; uri: string; size: number; base: string | null; as: "version" | "copy" }
  // Documents: edited fields (or Confirm), and Not a document / Mark as document.
  | DocOp

export const QUEUEABLE = ["rename", "move", "star", "trash", "restore", "newFolder", "applyTag", "saveText", "savePdf", "docPatch", "docMark"] as const
export const canQueue = (op: string) => (QUEUEABLE as readonly string[]).includes(op)

export const newTempId = () => `temp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
export const isTemp = (id: string | null) => !!id && id.startsWith("temp-")

// Every id an op points at, not counting the temporary id a new folder is born with.
export function idsOf(op: Op): string[] {
  const ids = op.op === "rename" || op.op === "saveText" || op.op === "savePdf" || op.op === "docPatch" ? [op.id] : op.op === "newFolder" ? [] : op.ids
  const parent = op.op === "move" || op.op === "newFolder" || op.op === "saveText" || op.op === "savePdf" ? [op.parentId] : []
  return [...ids, ...parent].filter((i): i is string => !!i)
}

// A move into a folder that was made offline names the folder by its temporary id; once the
// server has given it a real one, the rest of the queue is rewritten to match.
export function remap<T extends Op>(op: T, real: Record<string, string>): T {
  const swap = (id: string) => real[id] ?? id
  switch (op.op) {
    case "rename":
    case "docPatch":
      return { ...op, id: swap(op.id) }
    case "newFolder":
    case "saveText":
    case "savePdf":
      return { ...op, parentId: op.parentId && swap(op.parentId) }
    case "move":
      return { ...op, ids: op.ids.map(swap), parentId: op.parentId && swap(op.parentId) }
    default:
      return { ...op, ids: op.ids.map(swap) }
  }
}

// Still pointing at a folder whose creation never worked: it can't run.
export const unresolved = (op: Op, real: Record<string, string>) => idsOf(op).some((id) => isTemp(id) && !real[id])

export type Outcome = "retry" | "rename" | "fail"

// What to do with a change the server answered. "retry": leave it and everything after it for later.
// "rename": the name is taken, try `name (1)` once. "fail": the server wins; it goes to Couldn't sync.
export function classify(op: Op, err: { status: number; message?: string }): Outcome {
  const { status } = err
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry"
  const taken = status === 400 && /already in this folder/i.test(err.message ?? "")
  if (taken && (op.op === "rename" || op.op === "newFolder") && !op.clashed) return "rename"
  return "fail"
}

// "report.pdf" -> "report (1).pdf"; a folder or a name with no extension just gets the number.
export function clashName(name: string, folder = false) {
  const dot = name.lastIndexOf(".")
  if (folder || dot <= 0) return `${name} (1)`
  return `${name.slice(0, dot)} (1)${name.slice(dot)}`
}

export function renamed(op: Op): Op {
  if (op.op === "rename") return { ...op, name: clashName(op.name, op.folder), clashed: true }
  if (op.op === "newFolder") return { ...op, name: clashName(op.name, true), clashed: true }
  return op
}

// ---- Storage ----

// Marking past the cap asks first. `cap` null is no limit.
export function capCheck(used: number, adding: number, cap: number | null) {
  const total = used + adding
  const over = cap !== null && total > cap
  return { over, total, short: over ? total - cap! : 0 }
}

export const capLabel = (cap: number | null) => (cap === null ? "No limit" : `${cap / GB} GB`)

export type Listed = { id: string; version: string | null; size: number }
export type Known = { id: string; version: string | null }

// One refresh of one marked item: what to download, what no longer exists, and what the cap leaves out.
// New files are taken in order until the room runs out; `room` null is no limit.
export function planRefresh<L extends Listed, K extends Known>(known: K[], listed: L[], room: number | null) {
  const have = new Map(known.map((k) => [k.id, k.version]))
  const ids = new Set(listed.map((l) => l.id))
  const download: L[] = []
  const skipped: L[] = []
  let left = room
  for (const f of listed) {
    if (have.has(f.id) && have.get(f.id) === f.version) continue
    if (left !== null && f.size > left) skipped.push(f)
    else {
      download.push(f)
      if (left !== null) left -= f.size
    }
  }
  return { download, skipped, remove: known.filter((k) => !ids.has(k.id)) }
}

// A folder name safe to use in a path.
export const safeAccount = (account: string) => account.replace(/[^\w-]/g, "_")
