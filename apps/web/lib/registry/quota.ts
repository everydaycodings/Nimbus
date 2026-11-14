// Registry storage per namespace, separate from Drive quota.
import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryNamespaces, settings } from "@/lib/db/schema"

// Distinct blob bytes linked to any repo in the namespace, trashed repos included.
export async function registryUsage(namespaceId: string): Promise<number> {
  const [r] = await db.execute<{ n: string }>(sql`
    select coalesce(sum(b.size), 0)::text as n from registry_blobs b
    where b.digest in (
      select rb.digest from registry_repo_blobs rb
      join registry_repos r on r.id = rb.repo_id
      where r.namespace_id = ${namespaceId})`)
  return Number(r?.n ?? 0)
}

// Bytes left, or null when unlimited. The site owner's own namespace is never limited.
export async function registrySpaceLeft(namespaceId: string): Promise<number | null> {
  const [row] = await db
    .select({ own: registryNamespaces.quotaBytes, kind: registryNamespaces.kind, refId: registryNamespaces.refId, fallback: settings.registryDefaultQuotaBytes })
    .from(registryNamespaces)
    .leftJoin(settings, sql`true`)
    .where(eq(registryNamespaces.id, namespaceId))
  if (!row) return 0
  if (row.kind === "user") {
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, row.refId))
    if (u?.role === "owner") return null
  }
  const quota = row.own ?? row.fallback ?? null
  if (quota === null) return null
  return Math.max(0, quota - (await registryUsage(namespaceId)))
}
