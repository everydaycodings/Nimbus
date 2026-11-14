// What the engine reports after a push or delete: the webhook payload, and the bell for a
// namespace running out of registry storage.
import "server-only"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryNamespaces, registryOrgMembers } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { redis } from "@/lib/redis"

import { emit } from "./hooks.ts"
import { registrySpaceLeft, registryUsage } from "./quota.ts"

// {event, repository, tag?, digest, mediaType, size?, pushedBy?, at} (emit adds event and at).
export function announce(
  event: "push" | "delete" | "scan",
  repoId: string,
  repository: string,
  d: { tag?: string | null; digest: string; mediaType?: string; size?: number; pushedBy?: string }
) {
  return emit(event, repoId, { repository, ...d })
}

// Who to tell about a namespace: the user, or an org's owners.
export async function namespaceOwners(namespaceId: string): Promise<string[]> {
  const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  if (!ns) return []
  if (ns.kind === "user") return [ns.refId]
  const rows = await db.select({ id: registryOrgMembers.userId, role: registryOrgMembers.role }).from(registryOrgMembers).where(eq(registryOrgMembers.orgId, ns.refId))
  return rows.filter((r) => r.role === "owner").map((r) => r.id)
}

const warned = (namespaceId: string) => `registry:quota:warned:${namespaceId}`

// Warns once at 90% of the namespace's registry quota and re-arms under 85% (like lib/quota.ts
// checkStorage). The "already warned" flag lives in Redis; if Redis is down, nobody is told.
export async function checkRegistryQuota(namespaceId: string) {
  try {
    const left = await registrySpaceLeft(namespaceId)
    if (left === null) return void (await redis.del(warned(namespaceId)))
    const used = await registryUsage(namespaceId)
    const ratio = used / Math.max(1, used + left)
    if (ratio >= 0.9) {
      if (!(await redis.set(warned(namespaceId), "1", "NX"))) return
      const [ns] = await db.select({ name: registryNamespaces.name }).from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
      for (const id of await namespaceOwners(namespaceId))
        await notify(id, "registry_quota", { data: { name: ns?.name ?? "", percent: String(Math.min(100, Math.floor(ratio * 100))) } })
    } else if (ratio < 0.85) await redis.del(warned(namespaceId))
  } catch (e) {
    console.error("[registry] quota check:", e)
  }
}
