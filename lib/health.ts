// Service health: one probe per service, run by the BullMQ worker on the
// admin's interval (through /api/health/run) or by Run now. Results land in
// health_checks; lib/health-rules turns them into statuses and alerts.
import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import nodemailer from "nodemailer"

import { KIND_LABEL } from "@/lib/backup-rules"
import { testDest } from "@/lib/backup/dest"
import { backupStatus } from "@/lib/backup/status"
import { db } from "@/lib/db"
import { healthChecks, user } from "@/lib/db/schema"
import { appUrl, canSend, getEmailConfig } from "@/lib/email"
import {
  DEFAULT_SLOW_MS,
  SERVICES,
  SERVICE_LABEL,
  ago,
  alertOf,
  buckets,
  incidents,
  outcomeOf,
  statusOf,
  uptime,
  type Outcome,
  type Service,
  type Status,
} from "@/lib/health-rules"
import { notify } from "@/lib/notify"
import { HEARTBEAT_KEY, INDEXER_KEY, redis } from "@/lib/redis"
import { BUCKET, deleteObject, getText, putObject } from "@/lib/s3"
import { getSettings, type Settings } from "@/lib/signup"

const TIMEOUT = 10_000
const MINUTE = 60_000

// What a probe found. `off`: not set up, so there's nothing to check.
// `timed: false`: answered without a round trip, so latency means nothing.
type Found = { detail: string; off?: boolean; timed?: false }

const off = (detail: string): Found => ({ detail, off: true })

async function reach(url: string | URL, init: RequestInit = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code
    throw new Error(
      (e as Error).name === "TimeoutError"
        ? `No answer from ${new URL(url).host} in ${TIMEOUT / 1000} s.`
        : `Couldn't reach ${new URL(url).host}${cause ? ` (${cause})` : ""}.`
    )
  }
}

const PROBES: Record<Service, (s: Settings) => Promise<Found>> = {
  async postgres() {
    const [row] = await db.execute<{ v: string }>(
      sql`select current_setting('server_version') as v`
    )
    return { detail: `PostgreSQL ${row.v.split(" ")[0]} answered a query.` }
  },

  // A real write, read and delete: catches read-only keys and a full disk.
  async storage() {
    const key = "health/probe"
    await putObject(key, new TextEncoder().encode("ok"), "text/plain")
    if ((await getText(key)) !== "ok")
      throw new Error("The test file came back different.")
    await deleteObject(key)
    return { detail: `Wrote, read and deleted a test file in “${BUCKET}”.` }
  },

  async redis() {
    await redis.ping()
    const v = /redis_version:(\S+)/.exec(await redis.info("server"))?.[1]
    return {
      detail: v ? `Redis ${v} answered a ping.` : "Redis answered a ping.",
    }
  },

  async uploads() {
    if (!process.env.TUS_URL) throw new Error("TUS_URL is not set.")
    const url = new URL(process.env.TUS_URL, appUrl())
    const res = await reach(url, { method: "OPTIONS" })
    const v = res.headers.get("tus-version")
    if (!v)
      throw new Error(
        `${url.host} answered ${res.status}, but not as a tus server.`
      )
    return { detail: `tusd answered at ${url.host}.` }
  },

  async email() {
    const c = await getEmailConfig()
    if (c.transport === "none") return off("Email is off.")
    if (!canSend(c))
      throw new Error("Email is on but not finished: add a From address.")
    if (c.transport === "resend") {
      const res = await reach("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${c.resendApiKey}` },
      })
      const body = (await res.json().catch(() => null)) as {
        name?: string
        message?: string
      } | null
      // A send-only key can't list domains, which still proves it's valid.
      if (!res.ok && body?.name !== "restricted_api_key")
        throw new Error(body?.message ?? `Resend answered ${res.status}.`)
      return { detail: "Resend accepted the API key." }
    }
    const { host, port, secure, user: login, password } = c.smtp
    await nodemailer
      .createTransport({
        host,
        port,
        secure,
        auth: login ? { user: login, pass: password } : undefined,
        connectionTimeout: TIMEOUT,
      })
      .verify()
    return { detail: `Signed in to ${host}:${port}.` }
  },

  async office(s) {
    const url = s.officeUrl
    if (!url) return off("Not set up.")
    const res = await reach(`${url}/hosting/discovery`)
    if (!res.ok) throw new Error(`Collabora answered ${res.status}.`)
    if (!(await res.text()).includes("wopi-discovery"))
      throw new Error(`${new URL(url).host} answered, but not as Collabora.`)
    return { detail: `Collabora answered at ${new URL(url).host}.` }
  },

  // `npm run worker` leaves a key that expires a few minutes after its last sweep.
  async indexer() {
    const at = Number(await redis.get(INDEXER_KEY))
    if (!at)
      return off(
        "Not running. Start `npm run worker`; until then browsers read files as people open them."
      )
    return {
      detail: `Last sweep ${ago(new Date(at).toISOString(), Date.now())}.`,
      timed: false,
    }
  },

  async backups(s) {
    const b = await backupStatus(s)
    const on = b.kinds.filter((k) => k.schedule.enabled)
    if (b.error) throw new Error(b.error)
    if (!b.dest) {
      if (on.length) throw new Error("Backups are on, but no storage is set up.")
      return off("Not set up.")
    }
    await testDest(b.dest)
    if (on.length && !b.worker)
      throw new Error("The backup worker isn't running. Start `npm run worker:backup`.")
    for (const k of on) {
      if (k.last?.status === "failed")
        throw new Error(`The last ${KIND_LABEL[k.kind].toLowerCase()} backup failed: ${k.last.error}`)
      if (k.stale)
        throw new Error(`No good ${KIND_LABEL[k.kind].toLowerCase()} backup in over ${2 * k.schedule.intervalHours} h.`)
    }
    const last = on
      .flatMap((k) => (k.lastGood ? [`${KIND_LABEL[k.kind]} ${ago(k.lastGood.startedAt.toISOString(), Date.now())}`] : []))
      .join(", ")
    return { detail: `Wrote a test file to ${b.dest.bucket}.${last ? ` Last good: ${last}.` : ""}` }
  },

  async oauth() {
    const env = process.env
    const set = (["GOOGLE", "GITHUB"] as const).flatMap((p) => {
      const id = env[`${p}_CLIENT_ID`]
      const secret = env[`${p}_CLIENT_SECRET`]
      if (id && !secret) throw new Error(`${p}_CLIENT_SECRET is missing.`)
      if (!id && secret) throw new Error(`${p}_CLIENT_ID is missing.`)
      return id ? [p === "GOOGLE" ? "Google" : "GitHub"] : []
    })
    if (!set.length) return off("Only email and password.")
    return { detail: `${set.join(" and ")} set up.`, timed: false }
  },
}

const slowMs = (s: Settings, service: Service) =>
  s.healthSlowMs[service] ?? DEFAULT_SLOW_MS[service]

async function check(s: Settings, service: Service) {
  if (s.healthDisabled.includes(service))
    return {
      service,
      outcome: "off" as Outcome,
      latencyMs: null,
      detail: "Turned off in Health settings.",
    }
  const start = performance.now()
  const ms = () => Math.round(performance.now() - start)
  try {
    const found = await Promise.race([
      PROBES[service](s),
      new Promise<never>((_, no) =>
        setTimeout(
          () => no(new Error(`No answer in ${TIMEOUT / 1000} s.`)),
          TIMEOUT + 1000
        )
      ),
    ])
    const timed = found.timed !== false && !found.off
    return {
      service,
      outcome: (found.off
        ? "off"
        : outcomeOf(
            false,
            ms(),
            timed ? slowMs(s, service) : undefined
          )) as Outcome,
      latencyMs: timed ? ms() : null,
      detail: found.detail,
    }
  } catch (e) {
    return {
      service,
      outcome: "fail" as Outcome,
      latencyMs: ms(),
      detail: (e as Error).message || "Failed without saying why.",
    }
  }
}

// The newest `n` outcomes per service, newest first.
async function recentOutcomes(services: readonly Service[], n: number) {
  const rows = await db.execute<{ service: Service; outcome: Outcome }>(sql`
    select s.service, h.outcome
    from unnest(array[${sql.join(
      services.map((x) => sql`${x}`),
      sql`, `
    )}]::text[]) as s(service)
    cross join lateral (
      select outcome, checked_at from health_checks
      where service = s.service
      order by checked_at desc limit ${n}
    ) h
    order by s.service, h.checked_at desc`)
  const by = new Map<Service, Outcome[]>(services.map((x) => [x, []]))
  for (const r of rows) by.get(r.service)!.push(r.outcome)
  return by
}

export async function admins() {
  return db
    .select({ id: user.id })
    .from(user)
    .where(
      and(inArray(user.role, ["owner", "admin"]), eq(user.status, "active"))
    )
}

// Runs the probes (all, or the ones named), records them and alerts admins
// when a service goes down or comes back.
// ponytail: two overlapping runs can alert twice; lock in Redis if that shows up.
export async function runChecks(only: readonly Service[] = SERVICES) {
  const s = await getSettings()
  const results = await Promise.all(only.map((x) => check(s, x)))
  await db.insert(healthChecks).values(results)
  if (only.length === SERVICES.length)
    await db.execute(
      sql`delete from health_checks where checked_at < now() - make_interval(days => ${s.healthRetentionDays})`
    )

  const recent = await recentOutcomes(only, s.healthFailures + 1)
  const changed = results.flatMap((r) => {
    const state = alertOf(recent.get(r.service)!, s.healthFailures)
    return state ? [{ ...r, state }] : []
  })
  if (changed.length)
    for (const { id } of await admins())
      for (const c of changed)
        await notify(id, "service_health", {
          data: { service: c.service, state: c.state, detail: c.detail },
        })
  return results
}

// Last time the worker picked up a job, or null if it never has.
async function heartbeat() {
  try {
    return Number(await redis.get(HEARTBEAT_KEY)) || null
  } catch {
    return null
  }
}

// Scheduled checks are on, but the worker hasn't run for two intervals.
const isStale = (s: Settings, beat: number | null) =>
  s.healthIntervalMin !== null &&
  (beat === null || Date.now() - beat > 2 * s.healthIntervalMin * MINUTE)

// For the admin sidebar: something needs looking at.
export async function healthAlarm() {
  const s = await getSettings()
  const recent = await recentOutcomes(SERVICES, s.healthFailures)
  return (
    isStale(s, await heartbeat()) ||
    SERVICES.some((x) => statusOf(recent.get(x)!, s.healthFailures) === "down")
  )
}

export const RANGES = {
  "24h": { ms: 24 * 60 * MINUTE, bars: 48 },
  "7d": { ms: 7 * 24 * 60 * MINUTE, bars: 56 },
} as const
export type Range = keyof typeof RANGES

export type ServiceHealth = {
  service: Service
  label: string
  status: Status
  // The newest result, which tells slow from failing within "degraded".
  outcome: Outcome | null
  disabled: boolean
  latencyMs: number | null
  slowMs: number | null
  detail: string | null
  checkedAt: string | null
  uptime: number | null
  bars: (Outcome | null)[]
  incidents: { start: string; end: string | null; detail: string }[]
}

// Everything the Health page shows, for the last 24 hours or 7 days.
// ponytail: reads every row in the range (~16k for 7 days at 5 min); bucket in SQL if retention grows.
export async function healthOverview(range: Range) {
  const s = await getSettings()
  const now = Date.now()
  const from = now - RANGES[range].ms
  const [recent, rows, beat] = await Promise.all([
    recentOutcomes(SERVICES, s.healthFailures),
    db.execute<{
      service: Service
      outcome: Outcome
      latency_ms: number | null
      detail: string
      at: number
    }>(sql`
      select service, outcome, latency_ms, detail,
        (extract(epoch from checked_at) * 1000)::float8 as at
      from health_checks
      where checked_at >= to_timestamp(${from / 1000})
      order by checked_at`),
    heartbeat(),
  ])

  const services = SERVICES.map((service): ServiceHealth => {
    const mine = rows.filter((r) => r.service === service)
    const last = mine.at(-1)
    return {
      service,
      label: SERVICE_LABEL[service],
      status: statusOf(recent.get(service)!, s.healthFailures),
      outcome: recent.get(service)![0] ?? null,
      disabled: s.healthDisabled.includes(service),
      latencyMs: last?.latency_ms ?? null,
      slowMs: slowMs(s, service) ?? null,
      detail: last?.detail ?? null,
      checkedAt: last ? new Date(last.at).toISOString() : null,
      uptime: uptime(mine.map((r) => r.outcome)),
      bars: buckets(mine, from, now, RANGES[range].bars),
      incidents: incidents(mine)
        .slice(0, 5)
        .map((i) => ({
          start: new Date(i.first.at).toISOString(),
          end: i.end === null ? null : new Date(i.end).toISOString(),
          detail: i.first.detail,
        })),
    }
  })
  return {
    services,
    from,
    to: now,
    lastRun: rows.length ? new Date(rows.at(-1)!.at).toISOString() : null,
    heartbeat: beat && new Date(beat).toISOString(),
    stale: isStale(s, beat),
  }
}
