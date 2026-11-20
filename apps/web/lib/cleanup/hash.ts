// Clean up needs a SHA-256 for every file. The browser sends one with most uploads; the rest (WebDAV,
// S3, resumed uploads) get theirs here: the worker reads the object and fills it in, a little at a time.
import "server-only"

import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { getStream } from "@/lib/s3"

// Current versions of files in the open (not in a Vault) that still lack a hash.
const MISSING = sql`n.kind = 'file' and n.vault_id is null and v.enc_key is null and v.sha256 is null and n.size > 0`

export async function unhashedCount(ownerId: string) {
  const [r] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from nodes n join file_versions v on v.id = n.current_version_id
    where n.owner_id = ${ownerId} and n.trashed_at is null and ${MISSING}`)
  return r.n
}

// The worker's job: hashes for about a minute, newest first, then stops until the next run.
export async function backfillHashes() {
  const stop = Date.now() + 60_000
  while (Date.now() < stop) {
    const rows = await db.execute<{ id: string; key: string }>(sql`
      select v.id, v.s3_key as key from nodes n join file_versions v on v.id = n.current_version_id
      where ${MISSING} order by v.created_at desc limit 10`)
    if (!rows.length) return
    for (const r of rows) {
      const h = createHash("sha256")
      let sum: string
      try {
        for await (const c of (await getStream(r.key)) as unknown as AsyncIterable<Uint8Array>) h.update(c)
        sum = h.digest("hex")
      } catch (e) {
        if ((e as { name?: string }).name !== "NoSuchKey") throw e
        // The object is gone: a value no other file shares, so it's never picked again or grouped.
        sum = `missing:${r.id}`
      }
      await db.execute(sql`update file_versions set sha256 = ${sum} where id = ${r.id} and sha256 is null`)
    }
  }
}
