// What an upload's plan and its answers turn into. The web's rules (upload-provider.tsx), kept free of
// React Native so both engines share them and a test can run them.
import type { Conflict } from "@nimbus/shared/api"

// "version" is New version for a file and Merge for a folder.
export type Choice = "version" | "keep" | "skip"
export type Answers = Map<string, Choice>

// A file to send. No uri: an empty folder from a folder upload.
export type Entry = { path: string; size: number; uri?: string; mime?: string }

export const DATA_PROMPT_BYTES = 100 * 1024 * 1024
export const askBeforeData = (bytes: number, cellular: boolean) => cellular && bytes > DATA_PROMPT_BYTES

// Folders first. A folder kept as a copy or skipped can't clash inside, so its files are never asked about.
export function pendingConflicts(conflicts: Conflict[], answers: Answers) {
  const order = [...conflicts.filter((c) => c.kind === "folder"), ...conflicts.filter((c) => c.kind === "file")]
  return order.filter(
    (c) =>
      !answers.has(c.path) &&
      !order.some((f) => f.kind === "folder" && answers.has(f.path) && answers.get(f.path) !== "version" && c.path.startsWith(`${f.path}/`))
  )
}

// What's left to send, under its final path, and which of those become new versions.
export function applyAnswers(entries: Entry[], conflicts: Conflict[], answers: Answers) {
  let list = entries
  const versions = new Set<string>()
  // Folders first: their Keep both renames paths that file answers no longer match.
  for (const c of conflicts) {
    if (c.kind !== "folder") continue
    const a = answers.get(c.path)
    const inside = (p: string) => p === c.path || p.startsWith(`${c.path}/`)
    if (a === "skip") list = list.filter((e) => !inside(e.path))
    if (a === "keep") list = list.map((e) => (inside(e.path) ? { ...e, path: c.freeName + e.path.slice(c.path.length) } : e))
  }
  for (const c of conflicts) {
    if (c.kind !== "file") continue
    const a = answers.get(c.path)
    if (a === "skip") list = list.filter((e) => e.path !== c.path)
    if (a === "version") versions.add(c.path)
  }
  return { list, versions }
}

export type UploadStatus = "queued" | "waiting" | "uploading" | "paused" | "done" | "failed" | "refused"

export type UploadRow = {
  id: string
  accountId: string
  name: string
  mime: string
  size: number
  sent: number
  status: UploadStatus
  error?: string
  nodeId?: string
  asVersion?: boolean
  duplicateOf?: { id: string; path: string }
}

// The one line above the tabs. Ordered by what most needs saying.
export function stripSummary(rows: UploadRow[]) {
  const total = rows.length
  const done = rows.filter((r) => r.status === "done").length
  const failed = rows.filter((r) => r.status === "failed" || r.status === "refused").length
  // Same bytes already in Nimbus: Keep or Remove is the person's call, so these stay until they've seen them.
  const dupes = rows.filter((r) => r.status === "done" && r.duplicateOf).length
  const live = rows.filter((r) => r.status !== "done" && r.status !== "failed" && r.status !== "refused")
  const size = rows.reduce((n, r) => n + (r.status === "refused" ? 0 : r.size), 0)
  const sent = rows.reduce((n, r) => n + (r.status === "done" ? r.size : r.status === "refused" ? 0 : r.sent), 0)
  const progress = size ? Math.min(1, sent / size) : live.length ? 0 : 1
  const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`
  let text: string
  if (live.some((r) => r.status === "uploading" || r.status === "queued")) text = `Uploading ${Math.min(total, done + failed + 1)} of ${total}`
  else if (live.some((r) => r.status === "waiting")) text = "Waiting for Wi-Fi"
  else if (live.length) text = "Uploads paused"
  else if (failed) text = `${files(failed)} couldn't upload`
  else if (dupes) text = `${files(dupes)} already in Nimbus`
  else text = `Uploaded ${files(done)}`
  return { text, progress, active: live.length > 0, failed, dupes, finished: !live.length && !failed && !dupes }
}
