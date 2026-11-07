// Folder sync's shape as Kotlin reports it, and the words the screen shows. Free of React Native so a test can run it.

export type SyncPair = {
  id: string
  accountId: string
  name: string
  // The phone folder's name, and where it goes in My files.
  folderName: string
  remotePath: string
  twoWay: boolean
  paused: boolean
  state: "idle" | "running" | "waiting" | "failing" | "held" | "paused"
  reason: string | null
  lastAt?: number
  // Counts from the last run.
  up: number
  down: number
  removed: number
  conflicts: number
  done: number
  total: number
  failed: number
}

export type SyncFailure = { pairId: string; pairName: string; path: string; error: string }

export type SyncRules = { mobileData: boolean; chargingOnly: boolean; reliable: boolean }

export const DEFAULT_RULES: SyncRules = { mobileData: false, chargingOnly: false, reliable: false }

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

export function ago(ms: number, now = Date.now()) {
  const min = Math.round((now - ms) / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return n(Math.round(h / 24), "day") + " ago"
}

// What the last run did, in a few words: "2 uploaded, 1 saved, 1 removed".
export function summary(p: SyncPair) {
  const parts = [
    p.up && `${p.up} uploaded`,
    p.down && `${p.down} saved to phone`,
    p.removed && `${p.removed} removed`,
    p.conflicts && n(p.conflicts, "conflict"),
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : "Nothing changed"
}

// The line under a pair's name.
export function describePair(p: SyncPair, now = Date.now()) {
  switch (p.state) {
    case "paused":
      return "Paused"
    case "running":
      return p.total > 0 ? `Syncing ${Math.min(p.total, p.done + 1)} of ${p.total}` : "Checking for changes"
    case "waiting":
    case "failing":
    case "held":
      return p.reason ?? "Waiting"
    default:
      return p.lastAt ? `${p.failed ? n(p.failed, "problem") + " · " : ""}${summary(p)} · ${ago(p.lastAt, now)}` : "Not synced yet"
  }
}
