// Pure health-check rules: which services there are, how a run of results
// becomes a status, and the uptime bar. No `@/` imports, so the page, the
// worker and lib/health-rules.test.ts (node --test) all share it.

export const SERVICES = [
  "postgres",
  "storage",
  "redis",
  "uploads",
  "email",
  "office",
  "indexer",
  "oauth",
] as const
export type Service = (typeof SERVICES)[number]

export const SERVICE_LABEL: Record<Service, string> = {
  postgres: "Database",
  storage: "File storage",
  redis: "Redis",
  uploads: "Uploads",
  email: "Email",
  office: "Office viewer",
  indexer: "Search indexer",
  oauth: "Sign-in providers",
}

// What each check does, in the words the Health page uses.
export const PROBE_TEXT: Record<Service, string> = {
  postgres: "Runs a query against Postgres.",
  storage: "Writes, reads back and deletes a small test file in the bucket.",
  redis: "Pings Redis, which keeps the check schedule.",
  uploads: "Asks tusd, the resumable upload server, whether it's answering.",
  email:
    "Signs in to the SMTP server, or checks the Resend API key. Sends nothing.",
  office:
    "Fetches Collabora's discovery file from the server set under Office documents.",
  indexer: "Looks for a recent sweep from npm run indexer -- --watch.",
  oauth:
    "Checks that each Google or GitHub sign-in has both its client ID and secret.",
}

// Where to fix a service, when Nimbus has a page for it.
export const SERVICE_HREF: Partial<Record<Service, string>> = {
  email: "/admin/system/email",
  office: "/admin/system/office",
  indexer: "/admin/system/ocr",
}

// Choices for the check interval, in minutes.
export const INTERVALS = [1, 5, 15, 30, 60] as const

// Above this a working service shows as slow. Only services with a real
// round trip have one; the indexer and OAuth are checked without a request.
export const DEFAULT_SLOW_MS: Partial<Record<Service, number>> = {
  postgres: 250,
  storage: 1500,
  redis: 100,
  uploads: 1000,
  email: 3000,
  office: 3000,
}

// One probe's result, as stored. "off": not set up, or turned off.
export type Outcome = "ok" | "slow" | "fail" | "off"
// What the page shows: a failure is "degraded" until it repeats `failures` times.
export type Status = "ok" | "degraded" | "down" | "off"

export const outcomeOf = (failed: boolean, ms: number, slowMs?: number) =>
  failed ? "fail" : slowMs && ms > slowMs ? "slow" : "ok"

// Failures in a row at the start of `recent` (newest first).
export function failStreak(recent: Outcome[]) {
  const i = recent.findIndex((o) => o !== "fail")
  return i === -1 ? recent.length : i
}

export function statusOf(recent: Outcome[], failures: number): Status {
  const last = recent[0]
  if (!last || last === "off") return "off"
  if (last === "fail")
    return failStreak(recent) >= failures ? "down" : "degraded"
  return last === "slow" ? "degraded" : "ok"
}

// Whether the newest result (recent[0]) should alert: "down" exactly when the
// streak reaches `failures`, "up" on the first success after being down.
export function alertOf(recent: Outcome[], failures: number) {
  const streak = failStreak(recent)
  if (streak === failures) return "down"
  if (recent[0] === "ok" || recent[0] === "slow")
    return failStreak(recent.slice(1)) >= failures ? "up" : null
  return null
}

const WORST: Record<Outcome, number> = { off: 0, ok: 1, slow: 2, fail: 3 }

// The uptime bar: `n` equal slices of [from, to), each the worst outcome
// checked in it, or null when nothing ran.
export function buckets(
  rows: { outcome: Outcome; at: number }[],
  from: number,
  to: number,
  n: number
) {
  const out: (Outcome | null)[] = Array(n).fill(null)
  const size = (to - from) / n
  for (const r of rows) {
    const i = Math.floor((r.at - from) / size)
    if (i < 0 || i >= n) continue
    const b = out[i]
    if (b === null || WORST[r.outcome] > WORST[b]) out[i] = r.outcome
  }
  return out
}

// Share of checks that answered, ignoring the ones that didn't run. Null: none ran.
export function uptime(outcomes: Outcome[]) {
  const ran = outcomes.filter((o) => o !== "off")
  if (!ran.length) return null
  return ran.filter((o) => o !== "fail").length / ran.length
}

// Runs of failures, newest first. Any result that isn't a failure ends one.
export function incidents<T extends { outcome: Outcome; at: number }>(
  oldestFirst: T[]
) {
  const out: { first: T; end: number | null }[] = []
  let open: (typeof out)[number] | null = null
  for (const r of oldestFirst) {
    if (r.outcome === "fail") {
      if (!open) out.push((open = { first: r, end: null }))
    } else if (open) {
      open.end = r.at
      open = null
    }
  }
  return out.reverse()
}

// "3 min ago", from a fixed `now` so the server and browser agree.
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
