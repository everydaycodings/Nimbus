// What Secrets tells people (bell + email, through lib/notify), and the hourly
// sweep the worker runs: expiring access, rotation reminders, token expiry,
// spent share links and the trash's retention.
import "server-only"

import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  secretAccessRequests,
  secretEnvs,
  secretMembers,
  secretProjects,
  secretShares,
  secretTokens,
  secrets,
  settings,
} from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { dynSweep } from "./dynamic"
import { pkiSweep } from "./pki-sweep"
import type { Ctx } from "./service"

const link = (projectId: string, view: string) => `/secrets/${projectId}?view=${view}`

async function projectName(projectId: string) {
  const [p] = await db.select({ n: secretProjects.name }).from(secretProjects).where(eq(secretProjects.id, projectId))
  return p?.n ?? "a project"
}

export async function admins(projectId: string) {
  const rows = await db
    .select({ u: secretMembers.userId })
    .from(secretMembers)
    .where(and(eq(secretMembers.projectId, projectId), eq(secretMembers.role, "admin")))
  return rows.map((r) => r.u)
}

export async function tell(to: Iterable<string>, actorId: string | null, text: string, href: string) {
  for (const u of new Set(to))
    await notify(u, "secrets", { actorId, data: { text, href } }).catch((e) => console.error("secrets notice:", e))
}

// The people who may approve this environment's requests.
export async function approversOf(e: { projectId: string; approverIds: string[] | null }) {
  return e.approverIds?.length ? e.approverIds : admins(e.projectId)
}

export async function requestOpened(r: { id: string; projectId: string; authorId: string | null; authorName: string }, env: { name: string; projectId: string; approverIds: string[] | null }, n: number) {
  const name = await projectName(r.projectId)
  await tell(
    await approversOf(env),
    r.authorId,
    `${r.authorName} wants to change ${n} secret${n === 1 ? "" : "s"} in ${name} / ${env.name}. Review the request.`,
    link(r.projectId, `requests&request=${r.id}`)
  )
}

export async function requestResult(r: { id: string; projectId: string; authorId: string | null }, envName: string, outcome: "approved" | "rejected" | "merged", by: string | null) {
  if (!r.authorId) return
  const name = await projectName(r.projectId)
  const text = {
    approved: `Your change to ${name} / ${envName} was approved. Merge it when you're ready.`,
    rejected: `Your change to ${name} / ${envName} was rejected.`,
    merged: `Your change to ${name} / ${envName} was merged.`,
  }[outcome]
  await tell([r.authorId], by, text, link(r.projectId, `requests&request=${r.id}`))
}

export async function accessRequested(projectId: string, userId: string, who: string, envName: string, minutes: number) {
  const name = await projectName(projectId)
  const dur = minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`
  await tell(await admins(projectId), userId, `${who} asks for ${dur} of access to ${name} / ${envName}.`, link(projectId, "access-requests"))
}

export async function accessDecided(projectId: string, to: string, by: string | null, envName: string, outcome: "approved" | "denied" | "revoked" | "expired") {
  const name = await projectName(projectId)
  const text = {
    approved: `Your access to ${name} / ${envName} was approved.`,
    denied: `Your access request for ${name} / ${envName} was denied.`,
    revoked: `Your temporary access to ${name} / ${envName} was ended early.`,
    expired: `Your temporary access to ${name} / ${envName} has expired.`,
  }[outcome]
  await tell([to], by, text, link(projectId, "access-requests"))
}

export async function memberAdded(projectId: string, to: string, by: string, role: string) {
  const name = await projectName(projectId)
  await tell([to], by, `You were added to the Secrets project ${name} as ${role}.`, `/secrets/${projectId}`)
}

// A protected (or Production) environment changed: its project admins hear of it.
export async function envChanged(c: Ctx, envIds: string[], keys: string[]) {
  if (!envIds.length || !keys.length) return
  const envs = await db
    .select({ name: secretEnvs.name, slug: secretEnvs.slug, protected: secretEnvs.protected })
    .from(secretEnvs)
    .where(inArray(secretEnvs.id, envIds))
  const watched = envs.filter((e) => e.protected || e.slug === "production")
  if (!watched.length) return
  const name = await projectName(c.projectId)
  const list = keys.slice(0, 5).join(", ") + (keys.length > 5 ? ` and ${keys.length - 5} more` : "")
  await tell(
    await admins(c.projectId),
    c.userId || null,
    `${watched.map((e) => e.name).join(", ")} in ${name} changed: ${list}.`,
    link(c.projectId, "audit")
  )
}

// ---- Hourly sweep ---------------------------------------------------------

export async function sweep() {
  const now = new Date()
  const out = { access: 0, rotation: 0, tokens: 0, shares: 0, trash: 0, pki: {} as Awaited<ReturnType<typeof pkiSweep>>, dynamic: {} as Awaited<ReturnType<typeof dynSweep>> }

  // Temporary access that ran out: mark it, tell the person.
  const ended = await db
    .update(secretAccessRequests)
    .set({ expiredNotified: true })
    .where(and(eq(secretAccessRequests.status, "approved"), lte(secretAccessRequests.expiresAt, now), eq(secretAccessRequests.expiredNotified, false)))
    .returning()
  for (const a of ended) {
    const [e] = await db.select({ n: secretEnvs.name }).from(secretEnvs).where(eq(secretEnvs.id, a.envId))
    await accessDecided(a.projectId, a.userId, null, e?.n ?? "an environment", "expired")
    out.access++
  }

  // Rotation reminders, once per due date.
  const due = await db
    .select({ id: secrets.id, key: secrets.key, projectId: secrets.projectId, env: secretEnvs.name, slug: secretEnvs.slug, at: secrets.rotationAt })
    .from(secrets)
    .innerJoin(secretEnvs, eq(secretEnvs.id, secrets.envId))
    .where(
      and(
        isNull(secrets.deletedAt),
        isNotNull(secrets.rotationAt),
        lte(secrets.rotationAt, now),
        sql`${secrets.rotationNotifiedFor} is distinct from ${secrets.rotationAt}`
      )
    )
  for (const d of due) {
    const name = await projectName(d.projectId)
    await tell(await admins(d.projectId), null, `Time to rotate ${d.key} in ${name} / ${d.env}.`, link(d.projectId, d.slug))
    await db.update(secrets).set({ rotationNotifiedFor: d.at }).where(eq(secrets.id, d.id))
    out.rotation++
  }

  // Machine tokens expiring in 7 days, then in 1.
  for (const days of [1, 7] as const) {
    const soon = await db
      .select()
      .from(secretTokens)
      .where(
        and(
          isNull(secretTokens.revokedAt),
          isNotNull(secretTokens.expiresAt),
          lte(secretTokens.expiresAt, new Date(now.getTime() + days * 86_400_000)),
          sql`${secretTokens.expiresAt} > now()`,
          sql`coalesce(${secretTokens.warnedDays}, 99) > ${days}`
        )
      )
    for (const t of soon) {
      const name = await projectName(t.projectId)
      await tell(await admins(t.projectId), null, `The token “${t.name}” in ${name} expires in ${days === 1 ? "a day" : "7 days"}.`, link(t.projectId, "access"))
      await db.update(secretTokens).set({ warnedDays: days }).where(eq(secretTokens.id, t.id))
      out.tokens++
    }
  }

  // Share links that are spent, expired or revoked lose their sealed text; old rows go after a month.
  const spent = await db
    .update(secretShares)
    .set({ valueEnc: null })
    .where(and(isNotNull(secretShares.valueEnc), sql`(${secretShares.expiresAt} <= now() or ${secretShares.revokedAt} is not null or ${secretShares.views} >= ${secretShares.maxViews})`))
    .returning({ id: secretShares.id })
  out.shares = spent.length
  await db.delete(secretShares).where(lt(secretShares.expiresAt, new Date(now.getTime() - 30 * 86_400_000)))

  // The trash's retention, when an admin set one.
  const [s] = await db.select({ days: settings.secretTrashDays }).from(settings)
  if (s?.days) {
    const gone = await db
      .delete(secrets)
      .where(and(isNotNull(secrets.deletedAt), lt(secrets.deletedAt, new Date(now.getTime() - s.days * 86_400_000))))
      .returning({ id: secrets.id })
    out.trash = gone.length
  }
  // Certificates, API keys and watched domains: renewals and expiry warnings.
  out.pki = await pkiSweep({ admins, tell })
  // Database leases past their end and rotations that are due.
  out.dynamic = await dynSweep()
  return out
}
