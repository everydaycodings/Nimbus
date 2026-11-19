// The worker side of S3 metrics: s3-usage-flush (every minute) moves the Redis counters and
// activity events written by record.ts into Postgres; s3-usage-rollup (daily) keeps it small.
import "server-only"

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { s3Activity, s3Buckets, s3StorageDaily, s3Usage } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import { folderStats } from "./folder-stats.ts"
import { ACTIVITY_LIST } from "./record.ts"
import { parseCounterKey, type ActivityEvent } from "./record-rules.ts"

const DAY = 24 * 3600_000
const HOURLY_DAYS = 30
const DAILY_DAYS = 365
const ACTIVITY_DAYS = 30
const BATCH = 500

type Row = typeof s3Usage.$inferInsert

// Which of these buckets still exist; counters for a deleted bucket are dropped.
async function known(ids: string[]) {
  if (!ids.length) return new Set<string>()
  const rows = await db.select({ id: s3Buckets.id }).from(s3Buckets).where(inArray(s3Buckets.id, [...new Set(ids)]))
  return new Set(rows.map((r) => r.id))
}

// Adds the counts of `col` and excluded.`col`, keeping the 20 busiest names.
const mergeTop = (col: "agents" | "ips") =>
  sql.raw(`(select coalesce(jsonb_object_agg(k, v), '{}') from (select k, sum(v) v from (
    select key k, value::text::bigint v from jsonb_each(s3_usage.${col})
    union all select key, value::text::bigint from jsonb_each(excluded.${col})) x group by k order by 2 desc limit 20) y)`)

// Rows are added to what is already stored for the same bucket, key, hour and granularity.
async function addUsage(rows: Row[]) {
  const ok = await known(rows.map((r) => r.bucketId))
  for (const r of rows.filter((r) => ok.has(r.bucketId)))
    await db
      .insert(s3Usage)
      .values(r)
      .onConflictDoUpdate({
        target: [s3Usage.bucketId, s3Usage.keyId, s3Usage.hour, s3Usage.granularity],
        set: {
          reads: sql`s3_usage.reads + excluded.reads`,
          writes: sql`s3_usage.writes + excluded.writes`,
          lists: sql`s3_usage.lists + excluded.lists`,
          deletes: sql`s3_usage.deletes + excluded.deletes`,
          bytesIn: sql`s3_usage.bytes_in + excluded.bytes_in`,
          bytesOut: sql`s3_usage.bytes_out + excluded.bytes_out`,
          e4xx: sql`s3_usage.e4xx + excluded.e4xx`,
          e5xx: sql`s3_usage.e5xx + excluded.e5xx`,
          agents: mergeTop("agents"),
          ips: mergeTop("ips"),
        },
      })
}

// A counter hash from record.ts: r/w/l/d/bi/bo/e4/e5 plus a:<agent> and i:<ip> fields.
function rowOf(key: string, h: Record<string, string>): Row {
  const { hour, bucketId, keyId } = parseCounterKey(key)
  const n = (f: string) => Number(h[f]) || 0
  const top = (p: string) =>
    Object.fromEntries(
      Object.entries(h)
        .filter(([f]) => f.startsWith(p))
        .map(([f, v]) => [f.slice(p.length), Number(v)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
    )
  return {
    bucketId,
    keyId,
    hour: new Date(`${hour}:00:00Z`),
    granularity: "h",
    reads: n("r"),
    writes: n("w"),
    lists: n("l"),
    deletes: n("d"),
    bytesIn: n("bi"),
    bytesOut: n("bo"),
    e4xx: n("e4"),
    e5xx: n("e5"),
    agents: top("a:"),
    ips: top("i:"),
  }
}

async function flushCounters() {
  const keys: string[] = []
  let cursor = "0"
  do {
    const [next, found] = await redis.scan(cursor, "MATCH", "s3:u:*", "COUNT", 500)
    cursor = next
    keys.push(...found)
  } while (cursor !== "0")
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH)
    // Read and delete in one step so increments that land meanwhile start a fresh hash.
    // ponytail: a crash between this and the insert loses up to a minute of counts.
    const p = redis.multi()
    for (const k of chunk) p.hgetall(k).del(k)
    const out = (await p.exec()) ?? []
    const rows = chunk.flatMap((k, j) => {
      const h = out[j * 2]?.[1] as Record<string, string> | undefined
      return h && Object.keys(h).length ? [rowOf(k, h)] : []
    })
    await addUsage(rows)
  }
}

async function flushActivity() {
  for (;;) {
    // Oldest events are at the tail; trim them only after they are stored.
    const raw = await redis.lrange(ACTIVITY_LIST, -BATCH, -1)
    if (!raw.length) return
    const events = raw.reverse().map((r) => JSON.parse(r) as ActivityEvent)
    const ok = await known(events.map((e) => e.b))
    const rows = events
      .filter((e) => ok.has(e.b))
      .map((e) => ({ bucketId: e.b, keyId: e.k, at: new Date(e.at), op: e.op, objectKey: e.o, status: e.s, bytes: e.n, ip: e.ip, agent: e.ua }))
    if (rows.length) await db.insert(s3Activity).values(rows)
    await redis.ltrim(ACTIVITY_LIST, 0, -(raw.length + 1))
    if (raw.length < BATCH) return
  }
}

export async function flushUsage() {
  await flushCounters()
  await flushActivity()
}

// Hourly rows older than 30 days become one row per day, one day at a time.
async function foldDays() {
  const cutoff = new Date(Date.now() - HOURLY_DAYS * DAY)
  for (;;) {
    const [oldest] = await db
      .select({ hour: s3Usage.hour })
      .from(s3Usage)
      .where(and(eq(s3Usage.granularity, "h"), lt(s3Usage.hour, cutoff)))
      .orderBy(s3Usage.hour)
      .limit(1)
    if (!oldest) return
    const day = new Date(Math.floor(oldest.hour.getTime() / DAY) * DAY)
    const hours = await db
      .select()
      .from(s3Usage)
      
      .where(and(eq(s3Usage.granularity, "h"), gte(s3Usage.hour, day), lt(s3Usage.hour, new Date(day.getTime() + DAY))))
    const folded = new Map<string, Row>()
    for (const h of hours) {
      const k = `${h.bucketId}:${h.keyId}`
      const d = folded.get(k) ?? { ...h, id: undefined, hour: day, granularity: "d", reads: 0, writes: 0, lists: 0, deletes: 0, bytesIn: 0, bytesOut: 0, e4xx: 0, e5xx: 0, agents: {}, ips: {} }
      for (const f of ["reads", "writes", "lists", "deletes", "bytesIn", "bytesOut", "e4xx", "e5xx"] as const) d[f] = (d[f] ?? 0) + h[f]
      for (const f of ["agents", "ips"] as const) {
        const m = (d[f] ??= {}) as Record<string, number>
        for (const [name, c] of Object.entries(h[f])) m[name] = (m[name] ?? 0) + c
        d[f] = Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 20))
      }
      folded.set(k, d)
    }
    await addUsage([...folded.values()])
    await db.delete(s3Usage).where(inArray(s3Usage.id, hours.map((h) => h.id)))
  }
}

async function snapshotStorage() {
  const today = new Date().toISOString().slice(0, 10)
  const buckets = await db.select({ id: s3Buckets.id, nodeId: s3Buckets.nodeId }).from(s3Buckets)
  for (const b of buckets) {
    const s = await folderStats(b.nodeId)
    await db
      .insert(s3StorageDaily)
      .values({ bucketId: b.id, day: today, bytes: s.bytes, objects: s.objects })
      .onConflictDoUpdate({ target: [s3StorageDaily.bucketId, s3StorageDaily.day], set: { bytes: s.bytes, objects: s.objects } })
  }
}

export async function rollupUsage() {
  await foldDays()
  await db.delete(s3Usage).where(and(eq(s3Usage.granularity, "d"), lt(s3Usage.hour, new Date(Date.now() - DAILY_DAYS * DAY))))
  await db.delete(s3Activity).where(lt(s3Activity.at, new Date(Date.now() - ACTIVITY_DAYS * DAY)))
  await snapshotStorage()
}
