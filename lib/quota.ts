import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { settings, user } from "@/lib/db/schema"
import { DOC } from "@/lib/file-rules"

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
          when mime like 'image/%' then 'images'
          when mime like 'video/%' then 'videos'
          when mime = 'application/pdf' or mime like 'text/%'
            or name ~* ${DOC.source} then 'docs'
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
