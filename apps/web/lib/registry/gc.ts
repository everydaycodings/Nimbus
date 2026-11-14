// Online garbage collection (no read-only window). Order matters: trash purge frees rows,
// then untagged manifests nobody needs go, then repo-blob links no manifest in the repo
// uses, then blobs nothing references (and no repo links). Every delete re-checks its
// condition in the statement that deletes, so a push that re-links a blob mid-run wins.
import "server-only"

import { sql, type SQL } from "drizzle-orm"

import { db } from "@/lib/db"
import { deleteKeys } from "@/lib/s3"

import { GC_GRACE_HOURS, TRASH_DAYS } from "./rules.ts"

const HOUR = 3_600_000
const raw = (s: string) => sql.raw(s)

// A manifest other manifests need: the child of an index, or a referrer (signature, SBOM)
// of a manifest still in the repo. `m` is the table alias of the manifest row.
export const needed = (m: string): SQL => sql`(
  exists (select 1 from registry_manifest_refs r join registry_manifests p on p.id = r.manifest_id
    where r.kind = 'manifest' and r.digest = ${raw(m)}.digest and p.repo_id = ${raw(m)}.repo_id)
  or exists (select 1 from registry_manifests s where s.repo_id = ${raw(m)}.repo_id and s.digest = ${raw(m)}.subject))`

const untaggedGarbage = (cutoff: string): SQL => sql`m.deleted_at is null and m.created_at < ${cutoff}::timestamptz
  and not exists (select 1 from registry_tags t where t.repo_id = m.repo_id and t.digest = m.digest)
  and not ${needed("m")}`

const blobGarbage = (cutoff: string): SQL => sql`b.created_at < ${cutoff}::timestamptz
  and not exists (select 1 from registry_manifest_refs r where r.kind = 'blob' and r.digest = b.digest)
  and not exists (select 1 from registry_repo_blobs rb where rb.digest = b.digest)`

export async function runGc(opts: { dryRun?: boolean } = {}): Promise<{ blobs: number; bytes: number; manifests: number }> {
  const cutoff = new Date(Date.now() - GC_GRACE_HOURS * HOUR).toISOString()
  const out = { blobs: 0, bytes: 0, manifests: 0 }

  if (opts.dryRun) {
    const [m] = await db.execute<{ n: number }>(sql`select count(*)::int as n from registry_manifests m where ${untaggedGarbage(cutoff)}`)
    const [b] = await db.execute<{ n: number; s: string }>(
      sql`select count(*)::int as n, coalesce(sum(size), 0)::text as s from registry_blobs b where ${blobGarbage(cutoff)}`
    )
    return { blobs: b.n, bytes: Number(b.s), manifests: m.n }
  }

  // Deleting an index frees its children (and a subject frees its referrers), so go again until nothing's left.
  for (let i = 0; i < 10; i++) {
    const n = (await db.execute(sql`delete from registry_manifests m where ${untaggedGarbage(cutoff)} returning m.id`)).length
    out.manifests += n
    if (!n) break
  }
  await db.execute(sql`delete from registry_repo_blobs rb where rb.created_at < ${cutoff}::timestamptz
    and not exists (select 1 from registry_manifest_refs r join registry_manifests m on m.id = r.manifest_id
      where m.repo_id = rb.repo_id and r.kind = 'blob' and r.digest = rb.digest)`)

  for (;;) {
    // FOR UPDATE SKIP LOCKED: a blob a concurrent push is linking right now is left alone, and
    // holding the row lock blocks a new link until the delete below has re-checked.
    const gone = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ digest: string }>(
        sql`select digest from registry_blobs b where ${blobGarbage(cutoff)} order by b.created_at limit 200 for update skip locked`
      )
      if (!rows.length) return [] as { key: string; size: string }[]
      return await tx.execute<{ key: string; size: string }>(
        sql`delete from registry_blobs b where b.digest in (${sql.join(rows.map((r) => sql`${r.digest}`), sql`, `)}) and ${blobGarbage(cutoff)} returning b.key, b.size`
      )
    })
    if (!gone.length) break
    out.blobs += gone.length
    out.bytes += gone.reduce((a, r) => a + Number(r.size), 0)
    await deleteKeys(gone.map((r) => r.key))
  }
  return out
}

// Hard-deletes what has sat in the trash for TRASH_DAYS. A trashed manifest an index in the
// repo still lists stays (the child of a manifest must not vanish under it). The blobs go with GC.
export async function purgeTrash(): Promise<{ tags: number; manifests: number; repos: number }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * HOUR).toISOString()
  const repos = (await db.execute(sql`delete from registry_repos where deleted_at < ${cutoff}::timestamptz returning id`)).length
  const tags = (await db.execute(sql`delete from registry_tags where deleted_at < ${cutoff}::timestamptz returning id`)).length
  const manifests = (
    await db.execute(sql`delete from registry_manifests m where m.deleted_at < ${cutoff}::timestamptz
      and not exists (select 1 from registry_manifest_refs r join registry_manifests p on p.id = r.manifest_id
        where r.kind = 'manifest' and r.digest = m.digest and p.repo_id = m.repo_id and p.deleted_at is null)
      returning m.id`)
  ).length
  return { tags, manifests, repos }
}
