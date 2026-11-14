// Who may read or write which registry repo. Used by the protocol (R1a) and the web pages.
import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryNamespaces, registryOrgMembers, registryRepos } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { splitName, validRepoName } from "./rules"

// userId null: anonymous. tokenId null: a signed-in session rather than a token.
export type Actor = {
  userId: string | null
  tokenId: string | null
  access: "pull" | "push"
  allRepos: boolean
  repoIds: string[]
}
type Repo = typeof registryRepos.$inferSelect
type Ns = typeof registryNamespaces.$inferSelect

export async function resolveRepo(fullName: string): Promise<{ repo: Repo; namespace: Ns } | null> {
  const p = splitName(fullName)
  if (!p) return null
  const [row] = await db
    .select({ repo: registryRepos, namespace: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(
      and(
        sql`lower(${registryNamespaces.name}) = ${p.namespace.toLowerCase()}`,
        eq(registryRepos.name, p.repo),
        isNull(registryRepos.deletedAt)
      )
    )
  return row ?? null
}

// The member's role in the namespace: "owner" for their own, an org role, or null.
export async function roleIn(userId: string, ns: Ns): Promise<"owner" | "write" | "read" | null> {
  if (ns.kind === "user") return ns.refId === userId ? "owner" : null
  const [m] = await db
    .select({ role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, ns.refId), eq(registryOrgMembers.userId, userId)))
  return m?.role ?? null
}

export async function canPull(actor: Actor, repo: Repo, ns: Ns): Promise<boolean> {
  if (repo.isPublic && (await getSettings()).registryPublic) return true
  if (!actor.userId) return false
  if (actor.tokenId && !actor.allRepos && !actor.repoIds.includes(repo.id)) return false
  return (await roleIn(actor.userId, ns)) !== null
}

export async function canPush(actor: Actor, ns: Ns, repo?: Repo): Promise<boolean> {
  if (!actor.userId || actor.access !== "push") return false
  if (actor.tokenId && !actor.allRepos && !(repo && actor.repoIds.includes(repo.id))) return false
  const role = await roleIn(actor.userId, ns)
  return role === "owner" || role === "write"
}

export async function createRepoOnPush(actor: Actor, fullName: string): Promise<{ repo: Repo; namespace: Ns } | null> {
  const p = splitName(fullName)
  if (!p || !validRepoName(p.repo)) return null
  const [namespace] = await db
    .select()
    .from(registryNamespaces)
    .where(sql`lower(${registryNamespaces.name}) = ${p.namespace.toLowerCase()}`)
  if (!namespace || !(await canPush(actor, namespace))) return null
  const [made] = await db
    .insert(registryRepos)
    .values({ namespaceId: namespace.id, name: p.repo })
    .onConflictDoNothing()
    .returning()
  if (made) {
    const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, actor.userId!))
    await auditAs({ id: actor.userId, name: u?.name ?? "A member" }, "registry_repo_create", `${namespace.name}/${p.repo} (by push)`)
    return { repo: made, namespace }
  }
  // Another push made it first.
  return resolveRepo(fullName)
}

// Full names the actor can pull (token scope applied), sorted. Anonymous sees public repos only.
export async function catalogFor(actor: Actor): Promise<string[]> {
  const pub = (await getSettings()).registryPublic
  const live = isNull(registryRepos.deletedAt)
  const base = db
    .select({ ns: registryNamespaces.name, repo: registryRepos.name, id: registryRepos.id, isPublic: registryRepos.isPublic })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
  const rows: { ns: string; repo: string; id: string; isPublic: boolean }[] = []
  if (actor.userId) {
    const orgs = sql`select org_id::text from registry_org_members where user_id = ${actor.userId}`
    const mine = await base.where(
      and(
        live,
        sql`(${registryNamespaces.kind} = 'user' and ${registryNamespaces.refId} = ${actor.userId}) or (${registryNamespaces.kind} = 'org' and ${registryNamespaces.refId} in (${orgs}))`
      )
    )
    rows.push(...mine.filter((r) => !actor.tokenId || actor.allRepos || actor.repoIds.includes(r.id)))
  }
  if (pub) {
    const open = await base.where(and(live, eq(registryRepos.isPublic, true)))
    for (const r of open) if (!rows.some((x) => x.id === r.id)) rows.push(r)
  }
  return rows.map((r) => `${r.ns}/${r.repo}`).sort()
}
