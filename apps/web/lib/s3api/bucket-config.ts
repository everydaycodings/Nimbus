// Per-bucket settings (quota, lifecycle, CORS, public read) and the admin's S3 overview.
// Writes are limited to buckets in s3_buckets with user_id = userId; admin reads take no userId
// and must only be called after an admin check.
import "server-only"

import { randomBytes } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { s3Buckets, s3Keys, s3Usage, settings, user } from "@/lib/db/schema"
import { UUID } from "@/lib/files"
import { redis } from "@/lib/redis"

import { setKeyDisabled } from "./manage.ts"
import { bucketBytes } from "./quota.ts"
import { endpoint } from "./rules.ts"
import { checkCors, checkLifecycle, CORS_METHODS, quotaError } from "./config-rules.ts"

type Result = { error?: string }

export { CORS_METHODS }
export type CorsRule = {
  // Exact origins like "https://app.example.com", or "*".
  origins: string[]
  methods: (typeof CORS_METHODS)[number][]
  // Request headers allowed in a preflight; "*" allowed.
  headers: string[]
  // Response headers the browser may read, like "ETag".
  expose: string[]
  maxAgeSeconds: number
}

// Runs once a day. Objects go to the Nimbus Trash (not deleted for good).
export type LifecycleRule = {
  id: string
  // "" for the whole bucket.
  prefix: string
  // Objects whose current version is older than this many days go to the Trash.
  expireDays: number | null
  // Old (noncurrent) versions older than this many days are removed.
  noncurrentDays: number | null
  // Unfinished multipart uploads older than this many days are aborted.
  abortMultipartDays: number | null
}

export type LifecycleRun = { at: string; trashed: number; versions: number; uploads: number; error: string | null }

export type BucketConfig = {
  // The bucket's own limit, or null for none.
  quotaBytes: number | null
  // The admin's default limit for buckets without their own, or null.
  defaultQuotaBytes: number | null
  // Current size, as counted for the quota.
  bytes: number
  cors: CorsRule[]
  lifecycle: LifecycleRule[]
  lastRun: LifecycleRun | null
  // The admin allows public buckets on this server.
  publicAllowed: boolean
  // `<endpoint>/_public/<publicId>/` when public read is on, else null.
  publicUrl: string | null
}

const GONE = { error: "That bucket is gone. Refresh and try again." }

const mine = async (userId: string, id: string) => {
  if (!UUID.test(id)) return undefined
  const [b] = await db.select().from(s3Buckets).where(and(eq(s3Buckets.id, id), eq(s3Buckets.userId, userId)))
  return b
}

const publicUrl = (id: string | null) => (id && endpoint() ? `${endpoint()}/_public/${id}/` : null)

export async function getBucketConfig(userId: string, bucketId: string): Promise<BucketConfig | null> {
  const b = await mine(userId, bucketId)
  if (!b) return null
  const [s] = await db.select({ allowed: settings.s3PublicAllowed, quota: settings.s3DefaultQuota }).from(settings)
  return {
    quotaBytes: b.quotaBytes,
    defaultQuotaBytes: s?.quota ?? null,
    bytes: await bucketBytes(b),
    cors: b.cors ?? [],
    lifecycle: b.lifecycle ?? [],
    lastRun: b.lifecycleLastRun ?? null,
    publicAllowed: s?.allowed ?? false,
    publicUrl: s?.allowed ? publicUrl(b.publicId) : null,
  }
}

export async function setQuota(userId: string, bucketId: string, bytes: number | null): Promise<Result> {
  const b = await mine(userId, bucketId)
  if (!b) return GONE
  const bad = quotaError(bytes)
  if (bad) return { error: bad }
  await db.update(s3Buckets).set({ quotaBytes: bytes }).where(eq(s3Buckets.id, b.id))
  await audit("s3_bucket_quota", { detail: `${b.name}: ${b.quotaBytes ?? "none"} → ${bytes ?? "none"} bytes` })
  return {}
}

const corsKey = (name: string) => `s3:cors:${name}`

export async function setCors(userId: string, bucketId: string, rules: CorsRule[]): Promise<Result> {
  const b = await mine(userId, bucketId)
  if (!b) return GONE
  const c = checkCors(rules)
  if ("error" in c) return c
  await db.update(s3Buckets).set({ cors: c.rules.length ? c.rules : null }).where(eq(s3Buckets.id, b.id))
  await redis.del(corsKey(b.name)).catch(() => {})
  await audit("s3_bucket_cors", { detail: `${b.name}: ${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` })
  return {}
}

// What an unsigned preflight for `/<name>/…` may use: the rules of every bucket of that name
// (names are unique only per member), cached 30 s.
export async function corsRulesByName(name: string): Promise<CorsRule[]> {
  try {
    const hit = await redis.get(corsKey(name))
    if (hit) return JSON.parse(hit)
  } catch {}
  const rows = await db.select({ cors: s3Buckets.cors }).from(s3Buckets).where(eq(s3Buckets.name, name))
  const rules = rows.flatMap((r) => r.cors ?? [])
  await redis.set(corsKey(name), JSON.stringify(rules), "EX", 30).catch(() => {})
  return rules
}

export async function corsRulesOf(bucketId: string): Promise<CorsRule[]> {
  const [b] = await db.select({ cors: s3Buckets.cors }).from(s3Buckets).where(eq(s3Buckets.id, bucketId))
  return b?.cors ?? []
}

export async function setLifecycle(userId: string, bucketId: string, rules: LifecycleRule[]): Promise<Result> {
  const b = await mine(userId, bucketId)
  if (!b) return GONE
  const c = checkLifecycle(rules)
  if ("error" in c) return c
  await db.update(s3Buckets).set({ lifecycle: c.rules.length ? c.rules : null }).where(eq(s3Buckets.id, b.id))
  await audit("s3_bucket_lifecycle", { detail: `${b.name}: ${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` })
  return {}
}

// Turning it on makes a new public ID when there is none; `regenerate` always makes a new one
// (the old URL stops working).
export async function setPublic(userId: string, bucketId: string, on: boolean, regenerate = false): Promise<Result & { url?: string | null }> {
  const b = await mine(userId, bucketId)
  if (!b) return GONE
  if (on) {
    const [s] = await db.select({ allowed: settings.s3PublicAllowed }).from(settings)
    if (!s?.allowed) return { error: "The admin hasn't allowed public buckets on this server." }
  }
  const publicId = !on ? null : regenerate || !b.publicId ? randomBytes(18).toString("base64url") : b.publicId
  await db.update(s3Buckets).set({ publicId }).where(eq(s3Buckets.id, b.id))
  await audit("s3_bucket_public", { detail: `${b.name}: ${!on ? "turned off" : regenerate && b.publicId ? "new URL" : b.publicId ? "on" : "turned on"}` })
  return { url: publicUrl(publicId) }
}

// Admin → S3 API.
export type MemberUsage = { userId: string; name: string; email: string; buckets: number; storageBytes: number; requests: number; bytesIn: number; bytesOut: number }
export type AdminBucket = { id: string; name: string; member: string; memberId: string; bytes: number; requests: number; public: boolean }

// Requests and bytes per bucket over the last 30 days.
async function lastMonth() {
  const rows = await db
    .select({
      bucketId: s3Usage.bucketId,
      requests: sql<string>`sum(${s3Usage.reads} + ${s3Usage.writes} + ${s3Usage.lists} + ${s3Usage.deletes})`,
      bytesIn: sql<string>`sum(${s3Usage.bytesIn})`,
      bytesOut: sql<string>`sum(${s3Usage.bytesOut})`,
    })
    .from(s3Usage)
    .where(sql`${s3Usage.hour} >= now() - interval '30 days'`)
    .groupBy(s3Usage.bucketId)
  return new Map(rows.map((r) => [r.bucketId, { requests: Number(r.requests), bytesIn: Number(r.bytesIn), bytesOut: Number(r.bytesOut) }]))
}

// Every bucket with its member and size.
// ponytail: sizes come from bucketBytes (a folder walk, cached a minute) for each bucket; read the daily snapshot if a server has thousands.
async function allBuckets() {
  const rows = await db
    .select({ id: s3Buckets.id, nodeId: s3Buckets.nodeId, name: s3Buckets.name, publicId: s3Buckets.publicId, memberId: user.id, member: user.name, email: user.email })
    .from(s3Buckets)
    .innerJoin(user, eq(user.id, s3Buckets.userId))
  const usage = await lastMonth()
  return Promise.all(rows.map(async (r) => ({ ...r, bytes: await bucketBytes(r), ...(usage.get(r.id) ?? { requests: 0, bytesIn: 0, bytesOut: 0 }) })))
}

// Last 30 days, busiest first.
export async function usageByMember(limit = 50): Promise<MemberUsage[]> {
  const out = new Map<string, MemberUsage>()
  for (const b of await allBuckets()) {
    const m = out.get(b.memberId) ?? { userId: b.memberId, name: b.member, email: b.email, buckets: 0, storageBytes: 0, requests: 0, bytesIn: 0, bytesOut: 0 }
    m.buckets++
    m.storageBytes += b.bytes
    m.requests += b.requests
    m.bytesIn += b.bytesIn
    m.bytesOut += b.bytesOut
    out.set(b.memberId, m)
  }
  return [...out.values()].sort((a, b) => b.requests - a.requests || b.storageBytes - a.storageBytes).slice(0, limit)
}

// The biggest buckets first.
export async function topBuckets(limit = 10): Promise<AdminBucket[]> {
  return (await allBuckets())
    .sort((a, b) => b.bytes - a.bytes || b.requests - a.requests)
    .slice(0, limit)
    .map((b) => ({ id: b.id, name: b.name, member: b.member, memberId: b.memberId, bytes: b.bytes, requests: b.requests, public: b.publicId !== null }))
}

// Any member's key; audited as an admin action and the member is notified.
export async function adminSetKeyDisabled(id: string, disabled: boolean): Promise<Result> {
  if (!UUID.test(id)) return { error: "That key is gone. Refresh and try again." }
  const [k] = await db.select({ userId: s3Keys.userId }).from(s3Keys).where(eq(s3Keys.id, id))
  return k ? setKeyDisabled(k.userId, id, disabled, true) : { error: "That key is gone. Refresh and try again." }
}
