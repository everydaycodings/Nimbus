// S3 ETags are the MD5 of the bytes. Files that came in some other way (web,
// WebDAV before this existed) have none stored; they answer with their version
// id until the worker has read the object and filled it in.
import "server-only"

import { createHash } from "node:crypto"

import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { fileVersions } from "@/lib/db/schema"
import { enqueue } from "@/lib/redis"
import { getStream } from "@/lib/s3"

// The ETag a version shows, without quotes.
export const etagOf = (v: { id: string; etag: string | null }) => v.etag ?? v.id.replace(/-/g, "")

// One version, when a client asked for it and there's no MD5 yet.
export const enqueueVersionEtag = (versionId: string) =>
  enqueue("s3-etags", { versionId }, { jobId: `s3-etag-${versionId}` }).catch(() => {})

// Every file in a folder tree: when a folder becomes a bucket.
export const enqueueBucketEtags = (nodeId: string) =>
  enqueue("s3-etags", { nodeId }, { jobId: `s3-etags-${nodeId}` }).catch(() => {})

async function fill(id: string, key: string) {
  const md5 = createHash("md5")
  try {
    for await (const c of (await getStream(key)) as unknown as AsyncIterable<Uint8Array>) md5.update(c)
  } catch (e) {
    // The object's gone; there's nothing to hash.
    if ((e as { name?: string }).name === "NoSuchKey") return
    throw e
  }
  await db
    .update(fileVersions)
    .set({ etag: md5.digest("hex") })
    .where(and(eq(fileVersions.id, id), isNull(fileVersions.etag)))
}

// The worker's job: one version, or the current version of every file under a folder.
export async function computeEtags(d: { nodeId?: string; versionId?: string }) {
  const rows = d.versionId
    ? await db
        .select({ id: fileVersions.id, key: fileVersions.s3Key })
        .from(fileVersions)
        .where(and(eq(fileVersions.id, d.versionId), isNull(fileVersions.etag)))
    : await db.execute<{ id: string; key: string }>(sql`
        with recursive t as (
          select id from nodes where id = ${d.nodeId}
          union all
          select n.id from nodes n join t on n.parent_id = t.id where n.trashed_at is null
        )
        select v.id, v.s3_key as key from file_versions v join nodes n on n.current_version_id = v.id
        where n.id in (select id from t) and v.etag is null`)
  for (const r of rows) await fill(r.id, r.key)
}
