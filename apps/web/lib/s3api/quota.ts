// Bucket size limits: the bucket's own, else the admin's default (Admin → S3 API).
import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { s3Buckets, settings } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import { folderStats } from "./folder-stats.ts"
import { S3Error } from "./xml.ts"

const key = (bucketId: string) => `s3:bytes:${bucketId}`

// Current bytes of the bucket's files, counted at most once a minute.
export async function bucketBytes(b: { id: string; nodeId: string }) {
  try {
    const hit = await redis.get(key(b.id))
    if (hit !== null) return Number(hit)
  } catch {}
  const { bytes } = await folderStats(b.nodeId)
  await redis.set(key(b.id), bytes, "EX", 60).catch(() => {})
  return bytes
}

// Called after a write so the next check sees it.
export const bytesChanged = (bucketId: string) => redis.del(key(bucketId)).catch(() => {})

// Throws QuotaExceeded when `adding` more bytes would pass the limit.
// ponytail: an overwrite counts the new size on top of the old file, so it errs on the strict side.
export async function checkQuota(b: { id: string; nodeId: string }, adding: number) {
  const [row] = await db
    .select({ own: s3Buckets.quotaBytes, fallback: settings.s3DefaultQuota })
    .from(s3Buckets)
    .innerJoin(settings, sql`true`)
    .where(eq(s3Buckets.id, b.id))
  const limit = row?.own ?? row?.fallback ?? null
  if (limit === null) return
  if ((await bucketBytes(b)) + adding > limit)
    throw new S3Error("QuotaExceeded", "This bucket has reached its size limit. Delete files or ask for a higher limit.", 403)
}
