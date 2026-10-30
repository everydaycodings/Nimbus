import "server-only"

import { sql } from "drizzle-orm"

import { AVATAR_URL } from "@/lib/avatars"
import { db } from "@/lib/db"
import { reservedIds } from "@/lib/quota"
import { ORPHANS_KEY, redis } from "@/lib/redis"
import { listKeys, removeObjects } from "@/lib/s3"
import { orphans } from "@/lib/upload-rules"

export type SweepResult = { at: string; count: number; bytes: number }

// Weekly (and Admin → Health's Run now): deletes stored objects nothing points
// at any more, such as uploads that failed between S3 and the database. Which
// keys may count is decided in orphans().
// ponytail: holds every key in memory; page through the references if a bucket gets huge.
export async function sweepOrphans(): Promise<SweepResult> {
  // Listed before the references are read, so an object that lands in between
  // is either missing from the list or already referenced.
  const objects = (
    await Promise.all(["", "thumbs/", "avatars/"].map((p) => listKeys(p)))
  ).flat()
  const [files, avatars, live] = await Promise.all([
    db.execute<{ k: string }>(sql`
      select s3_key as k from file_versions
      union select s3_key from nodes where s3_key is not null`),
    db.execute<{ k: string }>(sql`
      select substr(image, ${AVATAR_URL.length + 1}) as k from "user"
      where starts_with(image, ${AVATAR_URL})`),
    reservedIds(),
  ])
  const used = new Set([...files.map((r) => r.k), ...live])
  const gone = orphans(objects, {
    files: used,
    avatars: new Set(avatars.map((r) => r.k)),
  })
  for (let i = 0; i < gone.length; i += 1000)
    await removeObjects(gone.slice(i, i + 1000).map((o) => o.key))
  const result = {
    at: new Date().toISOString(),
    count: gone.length,
    bytes: gone.reduce((n, o) => n + o.size, 0),
  }
  await redis.set(ORPHANS_KEY, JSON.stringify(result))
  return result
}

export async function lastSweep(): Promise<SweepResult | null> {
  const raw = await redis.get(ORPHANS_KEY).catch(() => null)
  return raw ? (JSON.parse(raw) as SweepResult) : null
}
