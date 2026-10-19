// Pure backup rules: the schedule, retention, how a restored copy is judged,
// and the cost estimate. Ported from dashv2's backup module. No `@/` imports,
// so the pages, scripts/backup-worker.ts and lib/backup-rules.test.ts
// (node --test) all share it.

export const KINDS = ["db", "files"] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABEL: Record<Kind, string> = {
  db: "Database",
  files: "Files",
}

// Hours a schedule can repeat at: divisors of 24, so runs land at the same
// local times every day.
export const INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const

export type RunStatus = "running" | "ok" | "warning" | "failed" | "skipped"
export type Trigger = "schedule" | "manual" | "retry" | "reverify"

export const PROVIDERS = ["aws", "r2", "b2", "wasabi", "minio", "other"] as const
export type Provider = (typeof PROVIDERS)[number]

export const PROVIDER_LABEL: Record<Provider, string> = {
  aws: "Amazon S3",
  r2: "Cloudflare R2",
  b2: "Backblaze B2",
  wasabi: "Wasabi",
  minio: "MinIO",
  other: "Other S3-compatible",
}

// ---- Time zones -----------------------------------------------------------

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The wall-clock date ("YYYY-MM-DD") and minute of day at `instant` in `tz`.
function localParts(instant: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value])
  )
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  }
}

// The instant a wall-clock `date` + `minutes` happens in `tz`.
function zonedInstant(date: string, minutes: number, tz: string) {
  const [y, m, d] = date.split("-").map(Number)
  const wall = Date.UTC(y, m - 1, d) + minutes * MINUTE_MS
  // Two passes settle the offset across a daylight-saving change.
  let at = wall
  for (let pass = 0; pass < 2; pass++) {
    const local = localParts(new Date(at), tz)
    const [ly, lm, ld] = local.date.split("-").map(Number)
    at += wall - (Date.UTC(ly, lm - 1, ld) + local.minutes * MINUTE_MS)
  }
  return new Date(at)
}

// ---- Schedule -------------------------------------------------------------

export type Schedule = {
  enabled: boolean
  intervalHours: number
  // "HH:MM"
  start: string
  tz: string
  paused: boolean
}

// The local hours a schedule runs at, ascending.
export function runHours(intervalHours: number, start: string) {
  const h = Number(start.slice(0, 2))
  return Array.from(
    { length: 24 / intervalHours },
    (_, i) => (h + i * intervalHours) % 24
  ).sort((a, b) => a - b)
}

// Five-field cron, evaluated in the schedule's own zone by BullMQ (`tz`).
export const toCron = (intervalHours: number, start: string) =>
  `${Number(start.slice(3, 5))} ${runHours(intervalHours, start).join(",")} * * *`

export const isActive = (s: Schedule) => s.enabled && !s.paused

// The next run strictly after `now`, or null when it isn't scheduled.
export function nextRun(s: Schedule, now: Date) {
  if (!isActive(s)) return null
  const minute = Number(s.start.slice(3, 5))
  // Yesterday through two days out covers every offset and a DST jump.
  for (let day = -1; day <= 2; day++) {
    const date = localParts(new Date(now.getTime() + day * DAY_MS), s.tz).date
    for (const hour of runHours(s.intervalHours, s.start)) {
      const at = zonedInstant(date, hour * 60 + minute, s.tz)
      if (at > now) return at
    }
  }
  return null
}

// No good backup within twice the interval. Never stale before the first
// good backup, or while it isn't scheduled.
export function isStale(s: Schedule, lastGood: Date | null, now: Date) {
  if (!isActive(s) || !lastGood) return false
  return now.getTime() - lastGood.getTime() > 2 * s.intervalHours * HOUR_MS
}

// ---- Retention ------------------------------------------------------------

export type Retention =
  | { mode: "last_n"; keepLast: number }
  | {
      mode: "tiered"
      hours: number
      days: number
      weeks: number
      months: number
    }

export type Retained = {
  id: string
  at: Date
  status: RunStatus
  pinned: boolean
}

// Files of failed runs are kept this long to look at, then deleted.
export const FAILED_KEEP_DAYS = 7

const isGood = (r: Retained) => r.status === "ok" || r.status === "warning"
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const utcMonth = (ms: number) => new Date(ms).toISOString().slice(0, 7)
// Monday of the ISO week.
const utcWeek = (ms: number) =>
  utcDay(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS)

// Which backup files retention deletes. Never: pinned files, and the newest
// good backup, so a bad setting can't leave nothing to restore.
export function selectToDelete(
  files: readonly Retained[],
  r: Retention,
  now: Date
) {
  const newest = [...files].sort((a, b) => b.at.getTime() - a.at.getTime())
  const good = newest.filter(isGood)
  const keep = new Set(newest.filter((f) => f.pinned).map((f) => f.id))
  if (good[0]) keep.add(good[0].id)
  const t = now.getTime()
  for (const f of newest)
    if (!isGood(f) && t - f.at.getTime() < FAILED_KEEP_DAYS * DAY_MS)
      keep.add(f.id)

  if (r.mode === "last_n") {
    for (const f of good.slice(0, r.keepLast)) keep.add(f.id)
  } else {
    for (const f of good)
      if (t - f.at.getTime() < r.hours * HOUR_MS) keep.add(f.id)
    const tiers: [(ms: number) => string, number][] = [
      [utcDay, r.days * DAY_MS],
      [utcWeek, r.weeks * 7 * DAY_MS],
      [utcMonth, r.months * 31 * DAY_MS],
    ]
    for (const [bucket, span] of tiers) {
      const seen = new Set<string>()
      for (const f of good) {
        const at = f.at.getTime()
        if (at < t - span || seen.has(bucket(at))) continue
        seen.add(bucket(at))
        keep.add(f.id)
      }
    }
  }
  return newest.filter((f) => !keep.has(f.id)).map((f) => f.id)
}

// ---- Verification ---------------------------------------------------------

// Enough of a database to prove a restored copy is the same.
export type Fingerprint = {
  // "schema.table" → rows and an order-independent md5 of every row.
  tables: Record<string, { rows: number; checksum: string }>
  // "schema.kind" → count, e.g. "public.indexes".
  objects: Record<string, number>
  // "schema.sequence" → last value, as a bigint string.
  sequences: Record<string, string>
}

export type Diff = {
  kind: "table" | "object" | "sequence" | "constraint"
  name: string
  live: string | null
  restored: string | null
}

const union = (a: object, b: object) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()

// Every difference; empty when the copy matches. pg_dump reads sequences a
// moment after the snapshot, so a restored one may be ahead but never behind.
export function diffFingerprints(live: Fingerprint, restored: Fingerprint) {
  const diffs: Diff[] = []
  const show = (t?: { rows: number; checksum: string }) =>
    t ? `${t.rows} rows · ${t.checksum.slice(0, 8)}` : null
  for (const name of union(live.tables, restored.tables)) {
    const a = live.tables[name]
    const b = restored.tables[name]
    if (a?.rows === b?.rows && a?.checksum === b?.checksum) continue
    diffs.push({ kind: "table", name, live: show(a), restored: show(b) })
  }
  for (const name of union(live.objects, restored.objects)) {
    const a = live.objects[name] ?? 0
    const b = restored.objects[name] ?? 0
    if (a !== b)
      diffs.push({ kind: "object", name, live: String(a), restored: String(b) })
  }
  for (const name of union(live.sequences, restored.sequences)) {
    const a = live.sequences[name]
    const b = restored.sequences[name]
    if (a !== undefined && b !== undefined && BigInt(b) >= BigInt(a)) continue
    diffs.push({
      kind: "sequence",
      name,
      live: a ?? null,
      restored: b ?? null,
    })
  }
  return diffs
}

// pg_restore errors that say nothing about the backup. Keep this list short
// and exact; anything else fails the run.
const HARMLESS = [/schema "public" already exists/]

// One message per error from pg_restore's stderr, split harmless/fatal.
export function restoreErrors(stderr: string) {
  const all: string[] = []
  for (const line of stderr.split("\n")) {
    if (line.startsWith("pg_restore: error:"))
      all.push(line.slice("pg_restore: error:".length).trim())
    else if (all.length && !line.startsWith("pg_restore:") && line.trim())
      all[all.length - 1] += `\n${line.trim()}`
  }
  const harmless = all.filter((e) => HARMLESS.some((p) => p.test(e)))
  return { harmless, fatal: all.filter((e) => !harmless.includes(e)) }
}

// What each check proved, by name. Missing: it didn't run.
export type Check = { ok: boolean; detail: string | null }
export type Checks = Partial<Record<CheckName, Check>>

// In proof-chain order.
export const CHECKS = {
  db: ["database", "restore", "schema", "integrity", "size", "file"],
  files: ["source", "copy", "prune", "sample"],
} as const
export type CheckName = (typeof CHECKS)[Kind][number]

export const CHECK_LABEL: Record<CheckName, string> = {
  database: "Snapshot",
  restore: "Restore",
  schema: "Schema",
  integrity: "Integrity",
  size: "Size",
  file: "Stored file",
  source: "Source",
  copy: "Copy",
  prune: "Prune",
  sample: "Sample re-read",
}

const FK_VIOLATION =
  /on table "([^"]+)" violates foreign key constraint "([^"]+)"/

// Turns the restore's errors and the two fingerprints into checks.
//
// One case is the live data's fault, not the backup's: rows that break a
// foreign key. If every table still matches exactly, the copy is faithful
// and the only loss is that constraint, which Postgres won't recreate over
// those rows: a warning naming it, not a failure.
export function judgeRestore(
  live: Fingerprint,
  restored: Fingerprint,
  fatal: string[]
): { diffs: Diff[]; checks: Checks } {
  const diffs = diffFingerprints(live, restored)
  const fk = fatal.flatMap((e) => {
    const m = FK_VIOLATION.exec(e)
    return m ? [{ table: m[1], constraint: m[2] }] : []
  })
  const others = fatal.filter((e) => !FK_VIOLATION.test(e))
  const tables = diffs.filter((d) => d.kind === "table")
  const schema = diffs.filter((d) => d.kind !== "table")
  const isFk = (d: Diff) => d.name.endsWith(".constraints_f")
  const missingFks = schema
    .filter(isFk)
    .reduce((n, d) => n + Number(d.live) - Number(d.restored), 0)
  if (
    fk.length &&
    !others.length &&
    !tables.length &&
    schema.every(isFk) &&
    missingFks === fk.length
  ) {
    const one = fk.length === 1
    return {
      diffs: [
        ...fk.map((f) => ({
          kind: "constraint" as const,
          name: `${f.table}.${f.constraint}`,
          live: "rows without a parent",
          restored: "constraint not created",
        })),
        ...diffs.filter((d) => !isFk(d)),
      ],
      checks: {
        restore: { ok: true, detail: null },
        schema: { ok: true, detail: null },
        integrity: {
          ok: false,
          detail: `The live data breaks ${one ? "a foreign key" : `${fk.length} foreign keys`} (${fk.map((f) => f.constraint).join(", ")}). The backup is an exact copy, but a restore would leave ${one ? "that constraint" : "those constraints"} off until the orphan rows are fixed.`,
        },
      },
    }
  }
  return {
    diffs,
    checks: {
      restore: fatal.length
        ? {
            ok: false,
            detail: `${fatal.length} restore error(s): ${fatal.map((e) => e.split("\n")[0]).join(" | ")}`.slice(0, 1000),
          }
        : tables.length
          ? { ok: false, detail: `${tables.length} table(s) differ from the live database.` }
          : { ok: true, detail: `Every table matches the live database, row for row.` },
      schema: schema.length
        ? { ok: false, detail: `${schema.length} schema object count(s) differ.` }
        : { ok: true, detail: "Same indexes, constraints, functions, triggers and views." },
      integrity: { ok: true, detail: "Every foreign key holds." },
    },
  }
}

// A dump this much smaller than the last good one is a warning: something
// may have deleted a lot. Null pct: off.
export function shrank(size: number, lastGood: number | null, pct: number | null) {
  if (!pct || !lastGood) return null
  const drop = ((lastGood - size) / lastGood) * 100
  return drop >= pct ? Math.round(drop) : null
}

// `pct`% of `keys`, at least `min` (or all of them), picked at random.
export function pickSample<T>(
  keys: readonly T[],
  pct: number,
  min = 20,
  rand = Math.random
) {
  const n = Math.min(keys.length, Math.max(min, Math.ceil((keys.length * pct) / 100)))
  const a = [...keys]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

// Error text that's safe to store and show: no connection strings, and no
// row values ("Key (email)=(…)").
export const scrub = (message: string) =>
  message
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, "($1)=(…)")
    .replace(/postgres(ql)?:\/\/\S+/g, "postgres://…")
    .slice(0, 1000)

// ---- Cost -----------------------------------------------------------------

// Storage list prices, US cents per GB-month (standard tier, no egress), as
// of 2026-10. An estimate shown as one.
const CENTS_PER_GB_MONTH: Partial<Record<Provider, number>> = {
  aws: 2.3,
  r2: 1.5,
  b2: 0.6,
  wasabi: 0.699,
}

// Monthly cost in cents, rounded up, or null when the price isn't known.
export function monthlyCents(provider: Provider, bytes: number) {
  const c = CENTS_PER_GB_MONTH[provider]
  return c === undefined ? null : Math.ceil((bytes / 1e9) * c)
}
