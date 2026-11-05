import "server-only"

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { settings, user } from "@/lib/db/schema"
import { AUDIO, DOC, IMAGE, TEXT, VIDEO } from "@/lib/file-rules"
import { notify } from "@/lib/notify"
import { redis } from "@/lib/redis"
import { RESERVE_TTL, reservedBytes } from "@/lib/upload-rules"

export type Usage = {
  // Every stored byte: current files, older versions and the trash.
  used: number
  // Null when there's no limit.
  quota: number | null
  images: number
  videos: number
  docs: number
  other: number
  // Everything in vaults, trash included (it's ciphertext, so no kinds).
  vault: number
  // Older versions and trashed files: `used` minus the current files.
  extra: number
}

// A restored version shares its object with the one it copies, so bytes are
// counted once per S3 key.
// ponytail: summed on every call; cache per user if big accounts get slow.
export async function getUsage(userId: string): Promise<Usage> {
  const [[stored], [current], quota] = await Promise.all([
    db.execute<{ used: string }>(sql`
      select coalesce(sum(size), 0)::text as used from (
        select distinct on (fv.s3_key) fv.size from file_versions fv
        join nodes n on n.id = fv.node_id
        where n.owner_id = ${userId}
      ) k`),
    db.execute<
      Record<"images" | "videos" | "docs" | "other" | "vault", string>
    >(sql`
      with f as (
        select size, case
          when vault_id is not null then 'vault'
          when name ~* ${IMAGE.source} then 'images'
          when name ~* ${VIDEO.source} then 'videos'
          when name ~* ${AUDIO.source} then 'other'
          when name ~* ${DOC.source} or name ~* ${TEXT.source}
            or name ~* '\\.pdf$' then 'docs'
          -- The stored mime type only for extensions the app doesn't know.
          when mime like 'image/%' then 'images'
          when mime like 'video/%' then 'videos'
          when mime = 'application/pdf' or mime like 'text/%' then 'docs'
          else 'other' end as cat
        from nodes
        where owner_id = ${userId} and kind = 'file'
          and (trashed_at is null or vault_id is not null)
      )
      select
        coalesce(sum(size) filter (where cat = 'images'), 0)::text as images,
        coalesce(sum(size) filter (where cat = 'videos'), 0)::text as videos,
        coalesce(sum(size) filter (where cat = 'docs'), 0)::text as docs,
        coalesce(sum(size) filter (where cat = 'other'), 0)::text as other,
        coalesce(sum(size) filter (where cat = 'vault'), 0)::text as vault
      from f`),
    quotaFor(userId),
  ])
  const images = Number(current.images)
  const videos = Number(current.videos)
  const docs = Number(current.docs)
  const other = Number(current.other)
  const vault = Number(current.vault)
  const used = Number(stored.used)
  return {
    used,
    quota,
    images,
    videos,
    docs,
    other,
    vault,
    extra: Math.max(0, used - images - videos - docs - other - vault),
  }
}

// The owner runs the server, so they're never limited.
export async function quotaFor(userId: string) {
  const [row] = await db
    .select({
      role: user.role,
      own: user.quotaBytes,
      fallback: settings.defaultQuotaBytes,
    })
    .from(user)
    .leftJoin(settings, sql`true`)
    .where(eq(user.id, userId))
  if (!row || row.role === "owner") return null
  return row.own ?? row.fallback ?? null
}

// Stored bytes per owner, counted the same way as getUsage().used.
export async function usedByOwner(ids: string[]) {
  if (!ids.length) return new Map<string, number>()
  const rows = await db.execute<{ owner: string; used: string }>(sql`
    select owner, sum(size)::text as used from (
      select distinct on (n.owner_id, fv.s3_key) n.owner_id as owner, fv.size
      from file_versions fv join nodes n on n.id = fv.node_id
      where n.owner_id in ${ids}
    ) k group by owner`)
  return new Map(rows.map((r) => [r.owner, Number(r.used)]))
}

// Bytes left, or null when unlimited.
export async function spaceLeft(userId: string) {
  const { used, quota } = await getUsage(userId)
  return quota === null ? null : Math.max(0, quota - used)
}

// Space held for tus uploads still in flight (see reservedBytes), so parallel
// uploads can't overshoot the quota together. Keyed by whose storage they fill.
const reserveKey = (ownerId: string) => `reserve:${ownerId}`

export async function reserved(ownerId: string) {
  return reservedBytes(await redis.hgetall(reserveKey(ownerId)))
}

export async function reserve(ownerId: string, uploadId: string, size: number) {
  await redis
    .multi()
    .hset(reserveKey(ownerId), uploadId, `${size}:${Date.now()}`)
    .pexpire(reserveKey(ownerId), RESERVE_TTL)
    .exec()
}

export async function release(ownerId: string, uploadId: string) {
  await redis.hdel(reserveKey(ownerId), uploadId).catch(() => {})
}

// Every upload id still holding space, for the orphan sweep.
export async function reservedIds() {
  const ids = new Set<string>()
  for await (const keys of redis.scanStream({ match: "reserve:*" }))
    for (const k of keys as string[])
      for (const id of await redis.hkeys(k)) ids.add(id)
  return ids
}

// The web uploader's speed cap for this account in bytes a second, or null.
export async function speedCap(userId: string) {
  const [row] = await db
    .select({ own: user.uploadSpeedBytes, fallback: settings.uploadSpeedBytes })
    .from(user)
    .leftJoin(settings, sql`true`)
    .where(eq(user.id, userId))
  return row?.own ?? row?.fallback ?? null
}

// Warns once (bell and email) when an account reaches 90% of its quota, and
// re-arms when it drops under 85%. Call after uploads land and after deletes.
export async function checkStorage(userId: string) {
  const quota = await quotaFor(userId)
  const used = quota === null ? 0 : (await getUsage(userId)).used
  if (quota !== null && used >= quota * 0.9) {
    const [first] = await db
      .update(user)
      .set({ storageWarnedAt: new Date() })
      .where(and(eq(user.id, userId), isNull(user.storageWarnedAt)))
      .returning({ id: user.id })
    if (first)
      await notify(userId, "storage_low", {
        data: {
          percent: String(Math.min(100, Math.floor((used / quota) * 100))),
        },
      })
  } else if (quota === null || used < quota * 0.85)
    await db
      .update(user)
      .set({ storageWarnedAt: null })
      .where(and(eq(user.id, userId), isNotNull(user.storageWarnedAt)))
}

// The hourly purge re-checks everyone warned, so a warning re-arms once space is freed.
export async function recheckWarned() {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(isNotNull(user.storageWarnedAt))
  for (const r of rows) await checkStorage(r.id)
}
