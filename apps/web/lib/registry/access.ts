// Who may read or write which registry repo. Used by the protocol (R1a) and the web pages.
import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import {
  registryNamespaces,
  registryOrgMembers,
  registryRepoAliases,
  registryRepoCollaborators,
  registryRepos,
  registryTeamMembers,
  registryTeamRepos,
} from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { logEvent } from "./activity.ts"
import { atLeast, maxRole, scopeAllows, splitName, validRepoName, type Role } from "./rules"

export type { Role }

// userId null: anonymous. tokenId null: a signed-in session rather than a token.
export type Actor = {
  userId: string | null
  tokenId: string | null
  access: "pull" | "push" | "delete"
  allRepos: boolean
  repoIds: string[]
}
type Repo = typeof registryRepos.$inferSelect
type Ns = typeof registryNamespaces.$inferSelect

// withAlias: a renamed repo's old name still answers (reads only; callers pass it for GET/HEAD).
export async function resolveRepo(fullName: string, withAlias = false): Promise<{ repo: Repo; namespace: Ns } | null> {
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
  if (row || !withAlias) return row ?? null
  return (await aliasTarget(fullName))?.target ?? null
}

// The live alias for an old name, with where the repo lives now.
export async function aliasTarget(fullName: string): Promise<{ target: { repo: Repo; namespace: Ns }; now: string } | null> {
  const p = splitName(fullName)
  if (!p) return null
  const [a] = await db
    .select({ repoId: registryRepoAliases.repoId })
    .from(registryRepoAliases)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepoAliases.namespaceId))
    .where(
      and(
        sql`lower(${registryNamespaces.name}) = ${p.namespace.toLowerCase()}`,
        sql`lower(${registryRepoAliases.name}) = ${p.repo.toLowerCase()}`,
        sql`${registryRepoAliases.expiresAt} > now()`
      )
    )
  if (!a) return null
  const [row] = await db
    .select({ repo: registryRepos, namespace: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, a.repoId), isNull(registryRepos.deletedAt)))
  return row ? { target: row, now: `${row.namespace.name}/${row.repo.name}` } : null
}

// The member's role in the namespace: "owner" for their own, an org role, or null.
export const MIRROR_REF = "system"

export async function roleIn(userId: string, ns: Ns): Promise<"owner" | "write" | "read" | null> {
  if (ns.kind === "user") return ns.refId === userId ? "owner" : null
  if (ns.refId === MIRROR_REF) return null // system mirror namespace: no members, and refId isn't a uuid
  const [m] = await db
    .select({ role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, ns.refId), eq(registryOrgMembers.userId, userId)))
  return m?.role ?? null
}

// The highest of the namespace role, any team's role on this repo and a collaborator role.
// A repo-level "admin" acts like the owner for that repo only.
export async function repoRole(userId: string, ns: Ns, repo?: { id: string }): Promise<Role | null> {
  const base = await roleIn(userId, ns)
  if (!repo) return base
  const [team, collab] = await Promise.all([
    db
      .select({ role: registryTeamRepos.role })
      .from(registryTeamRepos)
      .innerJoin(registryTeamMembers, eq(registryTeamMembers.teamId, registryTeamRepos.teamId))
      .where(and(eq(registryTeamRepos.repoId, repo.id), eq(registryTeamMembers.userId, userId))),
    db
      .select({ role: registryRepoCollaborators.role })
      .from(registryRepoCollaborators)
      .where(and(eq(registryRepoCollaborators.repoId, repo.id), eq(registryRepoCollaborators.userId, userId))),
  ])
  return maxRole(base, ...team.map((t) => t.role), ...collab.map((c) => c.role))
}

export async function canPull(actor: Actor, repo: Repo, ns: Ns): Promise<boolean> {
  if (repo.isPublic && (await getSettings()).registryPublic) return true
  if (!actor.userId) return false
  if (actor.tokenId && !actor.allRepos && !actor.repoIds.includes(repo.id)) return false
  return (await repoRole(actor.userId, ns, repo)) !== null
}

export async function canPush(actor: Actor, ns: Ns, repo?: Repo): Promise<boolean> {
  if (!actor.userId || !scopeAllows(actor.access, "push")) return false
  if (actor.tokenId && !actor.allRepos && !(repo && actor.repoIds.includes(repo.id))) return false
  return atLeast(await repoRole(actor.userId, ns, repo), "write")
}

// Deleting tags and manifests needs a token with the delete scope (a web session always has it) and write access.
export async function canDelete(actor: Actor, ns: Ns, repo: Repo): Promise<boolean> {
  if (!actor.userId || (actor.tokenId && !scopeAllows(actor.access, "delete"))) return false
  if (actor.tokenId && !actor.allRepos && !actor.repoIds.includes(repo.id)) return false
  return atLeast(await repoRole(actor.userId, ns, repo), "write")
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
    await logEvent({ namespaceId: namespace.id, repoId: made.id, actorId: actor.userId, actorName: u?.name ?? "A member", action: "repo_create", detail: { name: `${namespace.name}/${p.repo}`, by: "push" } })
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
