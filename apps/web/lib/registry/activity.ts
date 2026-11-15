// The registry activity log: who did what in a namespace or repo. Kept 90 days (purged by a daily job).
import "server-only"

import { and, desc, eq, lt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { redis } from "@/lib/redis"
import { registryEvents, registryNamespaces, registryRepos } from "@/lib/db/schema"

import { roleIn, repoRole } from "./access.ts"
import { atLeast } from "./rules.ts"

export type EventInput = {
  namespaceId: string
  repoId?: string | null
  actorId?: string | null
  actorName: string
  action: string
  detail?: Record<string, unknown>
  ip?: string | null
}

// A log line must never break the action it describes.
export async function logEvent(e: EventInput): Promise<void> {
  try {
    await db.insert(registryEvents).values({
      namespaceId: e.namespaceId,
      repoId: e.repoId ?? null,
      actorId: e.actorId ?? null,
      actorName: e.actorName,
      action: e.action,
      detail: e.detail ?? null,
      ip: e.ip ?? null,
    })
  } catch (err) {
    console.error("[registry] logEvent:", err)
  }
}

export type EventRow = {
  id: string
  repoId: string | null
  repoName: string | null
  actorId: string | null
  actorName: string
  action: string
  detail: Record<string, unknown> | null
  ip: string | null
  at: Date
}

export async function listEvents(o: { namespaceId?: string; repoId?: string; actorId?: string; before?: Date; limit?: number }): Promise<EventRow[]> {
  const where = and(
    o.namespaceId ? eq(registryEvents.namespaceId, o.namespaceId) : undefined,
    o.repoId ? eq(registryEvents.repoId, o.repoId) : undefined,
    o.actorId ? eq(registryEvents.actorId, o.actorId) : undefined,
    o.before ? lt(registryEvents.at, o.before) : undefined
  )
  return db
    .select({
      id: registryEvents.id,
      repoId: registryEvents.repoId,
      repoName: registryRepos.name,
      actorId: registryEvents.actorId,
      actorName: registryEvents.actorName,
      action: registryEvents.action,
      detail: registryEvents.detail,
      ip: registryEvents.ip,
      at: registryEvents.at,
    })
    .from(registryEvents)
    .leftJoin(registryRepos, eq(registryRepos.id, registryEvents.repoId))
    .where(where)
    .orderBy(desc(registryEvents.at))
    .limit(Math.min(o.limit ?? 50, 200))
}

// Namespace owners (org owners) see everything; a repo admin sees that repo's events.
export async function canSeeActivity(userId: string, namespaceId: string, repoId?: string): Promise<boolean> {
  const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  if (!ns) return false
  if ((await roleIn(userId, ns)) === "owner") return true
  if (!repoId) return false
  const [repo] = await db.select({ id: registryRepos.id }).from(registryRepos).where(and(eq(registryRepos.id, repoId), eq(registryRepos.namespaceId, namespaceId)))
  return !!repo && atLeast(await repoRole(userId, ns, repo), "admin")
}

export async function purgeEvents(days: number): Promise<number> {
  const gone = await db.delete(registryEvents).where(lt(registryEvents.at, sql`now() - ${days} * interval '1 day'`)).returning({ id: registryEvents.id })
  return gone.length
}

// A token used on a repo: one line a day per token and repo (Redis key with a 24 h TTL; down Redis logs nothing).
export async function logTokenUse(o: { tokenId: string | null; userId: string | null; name: string; ip: string | null; namespaceId: string; repoId: string }) {
  if (!o.tokenId) return
  try {
    if ((await redis.set(`registry:use:${o.tokenId}:${o.repoId}`, "1", "EX", 86_400, "NX")) !== "OK") return
    await logEvent({ namespaceId: o.namespaceId, repoId: o.repoId, actorId: o.userId, actorName: o.name, action: "token_use", detail: { tokenId: o.tokenId }, ip: o.ip })
  } catch {}
}
