// Build rows as the browser gets them (dates as ISO strings), plus the words the screens use for them.
import type { BuildRow, BuildStatus, BuildTrigger } from "./builds"

export type BuildItem = {
  id: string
  ruleId: string | null
  trigger: BuildTrigger
  ref: string | null
  commit: string | null
  status: BuildStatus
  reason: string | null
  tags: string[]
  digest: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  who: string | null
}

export const toItem = (b: BuildRow): BuildItem => ({
  id: b.id,
  ruleId: b.ruleId,
  trigger: b.trigger,
  ref: b.ref,
  commit: b.commit,
  status: b.status,
  reason: b.reason,
  tags: b.tags,
  digest: b.digest,
  createdAt: b.createdAt.toISOString(),
  startedAt: b.startedAt?.toISOString() ?? null,
  finishedAt: b.finishedAt?.toISOString() ?? null,
  who: b.createdByName,
})

export const isActive = (s: BuildStatus) => s === "queued" || s === "waiting" || s === "running"

export const TRIGGER_LABEL: Record<BuildTrigger, string> = {
  push: "Push",
  tag: "Tag",
  manual: "Manual",
  schedule: "Schedule",
  cli: "CLI",
  upload: "Upload",
}

// 83 -> "1m 23s", 3700 -> "1h 1m".
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// How long something has been waiting, in whole minutes: 40s -> "<1m", 7 min -> "7m", 135 min -> "2h 15m".
export function since(ms: number) {
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 1) return "<1m"
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export const buildMs = (b: Pick<BuildItem, "startedAt" | "finishedAt">, now = Date.now()) =>
  b.startedAt ? (b.finishedAt ? Date.parse(b.finishedAt) : now) - Date.parse(b.startedAt) : null

const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
export function ago(iso: string, now = Date.now()) {
  const s = (Date.parse(iso) - now) / 1000
  for (const [unit, n] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(s) >= n) return rel.format(Math.round(s / n), unit)
  return "just now"
}

export const SCHEDULES = [
  ["", "Off"],
  ["0 3 * * *", "Nightly"],
  ["0 3 * * 1", "Weekly"],
] as const

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const pad = (n: string) => n.padStart(2, "0")

// A cron line in plain words, for the handful of shapes people write; anything else is called custom.
export function describeCron(expr: string | null): string {
  if (!expr) return "Off"
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return "Not a valid schedule"
  const [m, h, dom, mon, dow] = f
  const num = /^\d+$/
  if (/^\*\/\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${m.slice(2)} minutes`
  if (num.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `Every hour at minute ${m}`
  if (num.test(m) && num.test(h) && dom === "*" && mon === "*") {
    const at = `${pad(h)}:${pad(m)}`
    if (dow === "*") return `Every day at ${at}`
    if (num.test(dow) && Number(dow) <= 7) return `Every ${DAYS[Number(dow) % 7]} at ${at}`
  }
  return "Custom schedule"
}
