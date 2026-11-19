// The worker's daily s3-lifecycle job: each bucket's rules move old files to the Trash, remove
// old versions and abort stale multipart uploads, then the bucket keeps a note of what happened.
import "server-only"

import { and, eq, isNotNull, lt, sql } from "drizzle-orm"

import { accessOne, atLeast } from "@/lib/access"
import { db } from "@/lib/db"
import { s3Buckets, s3Multipart } from "@/lib/db/schema"
import { checkStorage } from "@/lib/quota"
import { trashAs } from "@/lib/tree-ops"
import { deleteUnreferenced } from "@/lib/uploads"

import type { LifecycleRule, LifecycleRun } from "./bucket-config.ts"
import { abortBacking } from "./multipart.ts"
import { pruneEmpty, type Bucket } from "./resolve.ts"

const DAY = 86_400_000
const BATCH = 500

// The live files under `prefix` with their keys (the same walk the version listing does).
const files = (ownerId: string, nodeId: string, prefix: string) => sql`
  t as (
    select n.id, n.kind, n.name as path, n.parent_id, n.current_version_id
    from nodes n where n.owner_id = ${ownerId} and n.parent_id = ${nodeId} and n.vault_id is null and n.trashed_at is null
    union all
    select c.id, c.kind, t.path || '/' || c.name, c.parent_id, c.current_version_id
    from t join nodes c on c.parent_id = t.id
    where t.kind = 'folder' and c.vault_id is null and c.trashed_at is null
      and (starts_with(${prefix}::text, t.path || '/') or starts_with(t.path || '/', ${prefix}::text))
  )`

const chunks = <T>(a: T[]) => Array.from({ length: Math.ceil(a.length / BATCH) }, (_, i) => a.slice(i * BATCH, (i + 1) * BATCH))

// Applies one bucket's rules as of `now` and stores the result in lifecycle_last_run.
export async function runLifecycle(bucketId: string, now = new Date()): Promise<LifecycleRun> {
  const run: LifecycleRun = { at: now.toISOString(), trashed: 0, versions: 0, uploads: 0, error: null }
  const [b] = await db.select().from(s3Buckets).where(eq(s3Buckets.id, bucketId))
  if (!b) return run
  try {
    const a = await accessOne(b.userId, b.nodeId)
    if (!a || a.kind !== "folder" || a.trashed) throw new Error("The bucket's folder isn't available.")
    const bucket = { id: b.id, name: b.name, nodeId: b.nodeId, ownerId: a.ownerId } as Bucket
    const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString()
    for (const r of (b.lifecycle ?? []) as LifecycleRule[]) {
      if (r.expireDays) {
        if (!atLeast(a.role, "editor")) throw new Error("This member can only view the bucket's folder, so files can't be moved to the Trash.")
        const old = await db.execute<{ id: string; parent_id: string }>(sql`
          with recursive ${files(a.ownerId, b.nodeId, r.prefix)}
          select t.id, t.parent_id from t join file_versions v on v.id = t.current_version_id
          where t.kind = 'file' and starts_with(t.path, ${r.prefix}::text) and v.created_at < ${ago(r.expireDays)}`)
        for (const ids of chunks(old.map((o) => o.id))) {
          const res = await trashAs(b.userId, ids)
          if (res.error) throw new Error(res.error)
          run.trashed += ids.length
        }
        for (const p of new Set(old.map((o) => o.parent_id))) await pruneEmpty(bucket, p)
      }
      if (r.noncurrentDays || r.keepNewer) {
        if (!atLeast(a.role, "editor")) throw new Error("This member can only view the bucket's folder, so old versions can't be removed.")
        const old = await db.execute<{ id: string }>(sql`
          with recursive ${files(a.ownerId, b.nodeId, r.prefix)}
          select v.id from t join file_versions v on v.node_id = t.id
          where t.kind = 'file' and starts_with(t.path, ${r.prefix}::text) and v.id <> t.current_version_id and not v.keep
            -- Old since the next version replaced it, like S3's noncurrent days.
            ${r.noncurrentDays ? sql`and (select n.created_at from file_versions n where n.node_id = v.node_id and n.number > v.number order by n.number limit 1)
              < ${ago(r.noncurrentDays)}` : sql``}
            -- Past the newest N old versions of its file.
            ${r.keepNewer ? sql`and (select count(*) from file_versions o where o.node_id = v.node_id and o.id <> t.current_version_id and o.number > v.number)
              >= ${r.keepNewer}` : sql``}`)
        for (const ids of chunks(old.map((o) => o.id))) {
          // Re-checked in the delete: a version that became current meanwhile stays.
          const gone = await db.execute<{ s3_key: string }>(sql`
            delete from file_versions v using nodes n
            where v.id in ${ids} and n.id = v.node_id and n.current_version_id <> v.id returning v.s3_key`)
          await deleteUnreferenced(gone.map((g) => g.s3_key))
          run.versions += gone.length
        }
        if (old.length) await checkStorage(a.ownerId)
      }
      if (r.abortMultipartDays) {
        const stale = await db
          .select()
          .from(s3Multipart)
          .where(and(eq(s3Multipart.bucketId, b.id), lt(s3Multipart.createdAt, new Date(ago(r.abortMultipartDays))), sql`starts_with(${s3Multipart.key}, ${r.prefix}::text)`))
        for (const row of stale) {
          await abortBacking(row)
          await db.delete(s3Multipart).where(eq(s3Multipart.id, row.id))
          run.uploads++
        }
      }
    }
  } catch (e) {
    run.error = e instanceof Error ? e.message : "Something went wrong."
  }
  await db.update(s3Buckets).set({ lifecycleLastRun: run }).where(eq(s3Buckets.id, b.id))
  return run
}

export async function runAllLifecycles() {
  const rows = await db.select({ id: s3Buckets.id }).from(s3Buckets).where(isNotNull(s3Buckets.lifecycle))
  for (const r of rows) await runLifecycle(r.id)
}
