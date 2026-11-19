// Public read: GET and HEAD of /_public/<publicId>/<key> with no signature, only while the admin
// allows it and the bucket has that ID. `_` can't start a bucket name, so no real bucket clashes.
import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { s3Buckets, settings } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import type { Who } from "./auth.ts"
import { S3Error } from "./xml.ts"

const PER_SECOND = 20

// At most PER_SECOND requests per address per second; the rest get SlowDown.
export async function publicRateLimit(ip: string | null) {
  const k = `s3:pub:${ip ?? "unknown"}:${Math.floor(Date.now() / 1000)}`
  try {
    const [[, n]] = (await redis.multi().incr(k).expire(k, 2).exec()) as [[null, number]]
    if (n > PER_SECOND) throw new S3Error("SlowDown", "Please reduce your request rate.", 503)
  } catch (e) {
    if (e instanceof S3Error) throw e
  }
}

// The bucket behind a public ID and who may read it: the bucket's member, read only, this bucket only.
export async function publicBucket(publicId: string): Promise<{ who: Who; name: string; bucketId: string }> {
  const [row] = await db
    .select({ id: s3Buckets.id, name: s3Buckets.name, userId: s3Buckets.userId, allowed: settings.s3PublicAllowed })
    .from(s3Buckets)
    .innerJoin(settings, sql`true`)
    .where(eq(s3Buckets.publicId, publicId))
  if (!row?.allowed) throw new S3Error("NoSuchBucket", "The specified bucket does not exist.", 404)
  const who: Who = { keyId: "public", userId: row.userId, perms: new Set(["read"]), prefix: null, all: false, bucketIds: new Set([row.id]), rps: null }
  return { who, name: row.name, bucketId: row.id }
}
