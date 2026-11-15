// Cleanup policies: a namespace default with a per-repo override. The dry run (previewPolicy)
// and the real run (applyPolicy) share one selection (cleanup.ts), so they always agree.
// "Removing" is the soft delete: deletedAt now, purged after TRASH_DAYS (gc.ts).
import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryManifests, registryNamespaces, registryRepos, registryTags } from "@/lib/db/schema"

import { selectCleanup, type CleanupManifest } from "./cleanup.ts"
import { needed } from "./gc.ts"
import type { Policy } from "./rules.ts"

export async function effectivePolicy(repoId: string): Promise<Policy | null> {
  const [r] = await db
    .select({ own: registryRepos.policy, ns: registryNamespaces.policy })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(eq(registryRepos.id, repoId))
  return r?.own ?? r?.ns ?? null
}

async function select(repoId: string, policy: Policy | null | undefined) {
  const p = policy === undefined ? await effectivePolicy(repoId) : policy
  if (!p) return { tags: [], untagged: [] }
  const [repo] = await db.select({ immutable: registryRepos.immutablePattern }).from(registryRepos).where(eq(registryRepos.id, repoId))
  if (!repo) return { tags: [], untagged: [] }
  const tags = await db
    .select({ name: registryTags.name, pushedAt: registryTags.pushedAt, lastPulledAt: registryTags.lastPulledAt })
    .from(registryTags)
    .where(and(eq(registryTags.repoId, repoId), isNull(registryTags.deletedAt)))
  const manifests = await db.execute<{ digest: string; createdAt: Date; tagged: boolean; protectedBy: boolean }>(sql`
    select m.digest, m.created_at as "createdAt",
      exists (select 1 from registry_tags t where t.repo_id = m.repo_id and t.digest = m.digest) as tagged,
      ${needed("m")} as "protectedBy"
    from registry_manifests m where m.repo_id = ${repoId} and m.deleted_at is null`)
  return selectCleanup(p, tags, manifests.map((m) => ({ ...m, createdAt: new Date(m.createdAt) })) as CleanupManifest[], repo.immutable)
}

export const previewPolicy = (repoId: string, policy?: Policy | null) => select(repoId, policy)

export async function applyPolicy(repoId: string) {
  // Archived repos are read-only, cleanup included.
  const [r] = await db.select({ archivedAt: registryRepos.archivedAt }).from(registryRepos).where(eq(registryRepos.id, repoId))
  if (!r || r.archivedAt) return { tags: [], untagged: [] }
  const sel = await select(repoId, undefined)
  const now = new Date()
  if (sel.tags.length)
    await db
      .update(registryTags)
      .set({ deletedAt: now })
      .where(and(eq(registryTags.repoId, repoId), inArray(registryTags.name, sel.tags), isNull(registryTags.deletedAt)))
  if (sel.untagged.length)
    await db
      .update(registryManifests)
      .set({ deletedAt: now })
      .where(and(eq(registryManifests.repoId, repoId), inArray(registryManifests.digest, sel.untagged), isNull(registryManifests.deletedAt)))
  return sel
}
