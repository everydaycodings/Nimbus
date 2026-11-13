// Temporary access: a member asks for an environment with a role and a duration,
// a project admin approves, and it ends by itself. Ctx (service.projectCtx)
// only counts grants whose expires_at is still ahead, so expiry needs no sweep
// to take effect; the worker's sweep just tells the person.
import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretAccessRequests, secretEnvs, user } from "@/lib/db/schema"
import { accessMinutes } from "./gov-rules"
import { accessDecided, accessRequested } from "./notices"
import { SecretsError, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)

export async function listAccess(c: Ctx) {
  const rows = await db
    .select({
      id: secretAccessRequests.id,
      userId: secretAccessRequests.userId,
      who: user.name,
      env: secretEnvs.name,
      envId: secretAccessRequests.envId,
      role: secretAccessRequests.role,
      minutes: secretAccessRequests.minutes,
      reason: secretAccessRequests.reason,
      status: secretAccessRequests.status,
      expiresAt: secretAccessRequests.expiresAt,
      createdAt: secretAccessRequests.createdAt,
    })
    .from(secretAccessRequests)
    .innerJoin(user, eq(user.id, secretAccessRequests.userId))
    .innerJoin(secretEnvs, eq(secretEnvs.id, secretAccessRequests.envId))
    .where(
      and(
        eq(secretAccessRequests.projectId, c.projectId),
        c.role === "admin" ? undefined : eq(secretAccessRequests.userId, c.userId)
      )
    )
    .orderBy(desc(secretAccessRequests.createdAt))
    .limit(100)
  const now = Date.now()
  return rows.map((r) => ({
    ...r,
    mine: r.userId === c.userId,
    // Approved and still running, or approved and over.
    status: r.status === "approved" && r.expiresAt && r.expiresAt.getTime() <= now ? ("expired" as const) : r.status,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

// Environments this member could ask for: the ones they don't already have at that role.
export async function askable(c: Ctx) {
  if (c.role === "admin") return []
  const envs = await db.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId))
  return envs.map((e) => ({
    id: e.id,
    name: e.name,
    canView: !c.envs || !c.envs.includes(e.id),
    canWrite: !(c.writeEnvs === null || c.writeEnvs?.includes(e.id) || (c.writeEnvs === undefined && c.role !== "viewer")),
  }))
}

export async function requestAccess(c: Ctx, envId: string, role: string, minutes: unknown, reason: string) {
  if (c.role === "admin") throw bad("Admins already have every environment.")
  if (role !== "viewer" && role !== "developer") throw bad("Pick a role.")
  const mins = accessMinutes(minutes)
  if (!mins) throw bad("Pick a duration between 15 minutes and 30 days.")
  const why = reason.trim().slice(0, 500)
  if (!why) throw bad("Say why you need it.")
  const [e] = await db
    .select()
    .from(secretEnvs)
    .where(and(eq(secretEnvs.id, envId), eq(secretEnvs.projectId, c.projectId)))
  if (!e) throw bad("That environment doesn't exist.", 404)
  const sees = !c.envs || c.envs.includes(e.id)
  const writes = c.writeEnvs === undefined ? c.role !== "viewer" : c.writeEnvs === null || c.writeEnvs.includes(e.id)
  if (role === "viewer" ? sees : writes) throw bad("You already have that access here.", 409)
  const [open] = await db
    .select({ id: secretAccessRequests.id })
    .from(secretAccessRequests)
    .where(
      and(
        eq(secretAccessRequests.projectId, c.projectId),
        eq(secretAccessRequests.userId, c.userId),
        eq(secretAccessRequests.envId, envId),
        eq(secretAccessRequests.status, "pending")
      )
    )
  if (open) throw bad("You already asked for this one. An admin will answer.", 409)
  await db.insert(secretAccessRequests).values({ projectId: c.projectId, envId, userId: c.userId, role, minutes: mins, reason: why })
  const [u] = await db.select({ n: user.name }).from(user).where(eq(user.id, c.userId))
  await accessRequested(c.projectId, c.userId, u?.n ?? "A member", e.name, mins)
  await audit("secrets_access_request", { detail: `${e.name}: asked for ${role} access for ${mins} minutes: ${why}`, env: e.name })
}

export async function decideAccess(c: Ctx, id: string, action: "approve" | "deny" | "revoke") {
  const [r] = await db
    .select()
    .from(secretAccessRequests)
    .where(and(eq(secretAccessRequests.id, id), eq(secretAccessRequests.projectId, c.projectId)))
  if (!r) throw bad("That request isn't here.", 404)
  const [e] = await db.select({ n: secretEnvs.name }).from(secretEnvs).where(eq(secretEnvs.id, r.envId))
  const now = new Date()
  if (action === "revoke") {
    if (r.status !== "approved" || !r.expiresAt || r.expiresAt <= now) throw bad("That access isn't running.", 409)
    await db
      .update(secretAccessRequests)
      .set({ status: "revoked", decidedBy: c.userId, decidedAt: now, expiredNotified: true })
      .where(eq(secretAccessRequests.id, id))
    await accessDecided(c.projectId, r.userId, c.userId, e?.n ?? "", "revoked")
  } else {
    if (r.status !== "pending") throw bad("That request was already answered.", 409)
    if (r.userId === c.userId) throw bad("Ask another admin to approve your own request.", 403)
    await db
      .update(secretAccessRequests)
      .set(
        action === "approve"
          ? { status: "approved", decidedBy: c.userId, decidedAt: now, expiresAt: new Date(now.getTime() + r.minutes * 60_000) }
          : { status: "denied", decidedBy: c.userId, decidedAt: now }
      )
      .where(and(eq(secretAccessRequests.id, id), eq(secretAccessRequests.status, "pending")))
    await accessDecided(c.projectId, r.userId, c.userId, e?.n ?? "", action === "approve" ? "approved" : "denied")
  }
  await audit("secrets_access_decision", { targetId: r.userId, detail: `${e?.n ?? ""}: ${action} ${r.role} access`, env: e?.n })
}
