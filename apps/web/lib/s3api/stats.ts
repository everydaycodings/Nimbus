// S3 usage and activity, read side. Rows are written by the worker's s3-usage-flush
// (from Redis counters the S3 route records) and s3-usage-rollup jobs.
// Every query is limited to `scope.userId`'s own buckets and keys.
import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"

export type Range = "24h" | "7d" | "30d" | "1y"
// A bucket, a key, or (neither) everything the member owns.
export type Scope = { userId: string; bucketId?: string; keyId?: string }

export type Counts = {
  reads: number
  writes: number
  lists: number
  deletes: number
  bytesIn: number
  bytesOut: number
  e4xx: number
  e5xx: number
}
// One step of a chart: hourly for 24h and 7d, daily for 30d and 1y. Steps with
// no traffic are present with zeros, oldest first, ending with the current step.
export type Point = Counts & { at: string }

export type Top = { label: string; id?: string; requests: number; bytes: number }

export type ActivityRow = {
  id: string
  at: string
  // PUT, COPY, DELETE, DELETE_MANY, MULTIPART_COMPLETE, or the S3 operation that failed (GET, HEAD, LIST, …).
  op: string
  bucket: string
  bucketId: string
  objectKey: string | null
  keyName: string | null
  accessKeyId: string | null
  keyId: string | null
  status: number
  bytes: number
  ip: string | null
  agent: string | null
}

export type ActivityFilter = { op?: string; keyId?: string; errorsOnly?: boolean }

const HOUR = 3600_000
const DAY = 24 * HOUR
// Steps per range, and whether a step is an hour.
const STEPS: Record<Range, { n: number; hourly: boolean }> = {
  "24h": { n: 24, hourly: true },
  "7d": { n: 168, hourly: true },
  "30d": { n: 30, hourly: false },
  "1y": { n: 365, hourly: false },
}

const ZERO: Counts = { reads: 0, writes: 0, lists: 0, deletes: 0, bytesIn: 0, bytesOut: 0, e4xx: 0, e5xx: 0 }
const SUMS = sql`coalesce(sum(reads), 0) reads, coalesce(sum(writes), 0) writes, coalesce(sum(lists), 0) lists,
  coalesce(sum(deletes), 0) deletes, coalesce(sum(bytes_in), 0) bytes_in, coalesce(sum(bytes_out), 0) bytes_out,
  coalesce(sum(e4xx), 0) e4xx, coalesce(sum(e5xx), 0) e5xx`

type SumRow = Record<"reads" | "writes" | "lists" | "deletes" | "bytes_in" | "bytes_out" | "e4xx" | "e5xx", string>
const counts = (r: SumRow): Counts => ({
  reads: Number(r.reads),
  writes: Number(r.writes),
  lists: Number(r.lists),
  deletes: Number(r.deletes),
  bytesIn: Number(r.bytes_in),
  bytesOut: Number(r.bytes_out),
  e4xx: Number(r.e4xx),
  e5xx: Number(r.e5xx),
})

// The first step of the range, in UTC.
function startOf(range: Range) {
  const { n, hourly } = STEPS[range]
  const unit = hourly ? HOUR : DAY
  return new Date((Math.floor(Date.now() / unit) - (n - 1)) * unit)
}

// Rows of s3_usage (alias u) in the range and scope.
const usageWhere = (s: Scope, range: Range) => sql`u.hour >= ${startOf(range).toISOString()}::timestamptz
  and u.bucket_id in (select id from s3_buckets where user_id = ${s.userId})
  ${s.bucketId ? sql`and u.bucket_id = ${s.bucketId}` : sql``}
  ${s.keyId ? sql`and u.key_id = ${s.keyId}` : sql``}`

export async function usage(scope: Scope, range: Range): Promise<Point[]> {
  const { n, hourly } = STEPS[range]
  const rows = await db.execute<SumRow & { step: string }>(sql`
    select date_trunc(${hourly ? "hour" : "day"}, u.hour at time zone 'UTC') at time zone 'UTC' as step, ${SUMS}
    from s3_usage u where ${usageWhere(scope, range)} group by 1`)
  const byStep = new Map(rows.map((r) => [new Date(r.step).getTime(), counts(r)]))
  const start = startOf(range).getTime()
  const unit = hourly ? HOUR : DAY
  return Array.from({ length: n }, (_, i) => {
    const t = start + i * unit
    return { at: new Date(t).toISOString(), ...(byStep.get(t) ?? ZERO) }
  })
}

export async function totals(scope: Scope, range: Range): Promise<Counts & { requests: number }> {
  const [r] = await db.execute<SumRow>(sql`select ${SUMS} from s3_usage u where ${usageWhere(scope, range)}`)
  const c = counts(r)
  return { ...c, requests: c.reads + c.writes + c.lists + c.deletes }
}

// The busiest keys, buckets, client addresses or user-agent families in the range.
// Addresses and agents are counted in requests only (bytes is 0).
export async function top(scope: Scope, dim: "key" | "bucket" | "ip" | "agent", range: Range, limit = 5): Promise<Top[]> {
  const requests = sql`sum(u.reads + u.writes + u.lists + u.deletes)`
  const bytes = sql`sum(u.bytes_in + u.bytes_out)`
  const where = usageWhere(scope, range)
  type R = { label: string | null; id: string | null; requests: string; bytes: string }
  let rows: R[]
  if (dim === "key")
    rows = await db.execute<R>(sql`
      select coalesce(k.name, 'Deleted key') label, u.key_id::text id, ${requests} requests, ${bytes} bytes
      from s3_usage u left join s3_keys k on k.id = u.key_id where ${where}
      group by u.key_id, k.name order by 3 desc limit ${limit}`)
  else if (dim === "bucket")
    rows = await db.execute<R>(sql`
      select b.name label, b.id::text id, ${requests} requests, ${bytes} bytes
      from s3_usage u join s3_buckets b on b.id = u.bucket_id where ${where}
      group by b.id, b.name order by 3 desc limit ${limit}`)
  else
    rows = await db.execute<R>(sql`
      select e.key label, null id, sum(e.value::text::bigint) requests, 0 bytes
      from s3_usage u, jsonb_each(${sql.raw(dim === "ip" ? "u.ips" : "u.agents")}) e where ${where}
      group by e.key order by 3 desc limit ${limit}`)
  return rows.map((r) => ({ label: r.label ?? "", ...(r.id && { id: r.id }), requests: Number(r.requests), bytes: Number(r.bytes) }))
}

// Newest first. `cursor` is the `next` of the previous page.
export async function activity(
  scope: Scope,
  filter: ActivityFilter,
  cursor?: string,
  limit = 50
): Promise<{ rows: ActivityRow[]; next: string | null }> {
  const [cAt, cId] = cursor?.split("|") ?? []
  const rows = await db.execute<{
    id: string; at: string; op: string; bucket: string; bucket_id: string; object_key: string | null
    key_name: string | null; access_key_id: string | null; key_id: string | null; status: number; bytes: string
    ip: string | null; agent: string | null; at_iso: string
  }>(sql`
    select a.id::text, a.at, to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at_iso, a.op, b.name bucket, a.bucket_id::text,
      a.object_key, k.name key_name, k.access_key_id, a.key_id::text, a.status, a.bytes, a.ip, a.agent
    from s3_activity a join s3_buckets b on b.id = a.bucket_id left join s3_keys k on k.id = a.key_id
    where b.user_id = ${scope.userId}
      ${scope.bucketId ? sql`and a.bucket_id = ${scope.bucketId}` : sql``}
      ${scope.keyId ? sql`and a.key_id = ${scope.keyId}` : sql``}
      ${filter.keyId ? sql`and a.key_id = ${filter.keyId}` : sql``}
      ${filter.op ? sql`and a.op = ${filter.op}` : sql``}
      ${filter.errorsOnly ? sql`and a.status >= 400` : sql``}
      ${cAt && cId ? sql`and (a.at, a.id) < (${cAt}::timestamptz, ${cId}::bigint)` : sql``}
    order by a.at desc, a.id desc limit ${limit + 1}`)
  const page = rows.slice(0, limit)
  const last = rows.length > limit ? rows[limit - 1] : null
  return {
    rows: page.map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      op: r.op,
      bucket: r.bucket,
      bucketId: r.bucket_id,
      objectKey: r.object_key,
      keyName: r.key_name,
      accessKeyId: r.access_key_id,
      keyId: r.key_id,
      status: r.status,
      bytes: Number(r.bytes),
      ip: r.ip,
      agent: r.agent,
    })),
    next: last ? `${last.at_iso}|${last.id}` : null,
  }
}

// Daily snapshots of a bucket's size, oldest first.
export async function storageTrend(userId: string, bucketId: string, days = 30): Promise<{ day: string; bytes: number; objects: number }[]> {
  const rows = await db.execute<{ day: string; bytes: string; objects: string }>(sql`
    select d.day::text, d.bytes, d.objects from s3_storage_daily d join s3_buckets b on b.id = d.bucket_id
    where b.user_id = ${userId} and d.bucket_id = ${bucketId} and d.day > (now() at time zone 'UTC')::date - ${days}::int
    order by d.day`)
  return rows.map((r) => ({ day: r.day, bytes: Number(r.bytes), objects: Number(r.objects) }))
}
