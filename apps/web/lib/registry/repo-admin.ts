// Per-repo administration: collaborators, teams, rename/move, archive, description.
// Every function takes the acting member and checks their role itself; errors come back as { error }.
import "server-only"

import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import {
  registryHooks,
  registryNamespaces,
  registryOrgMembers,
  registryRepoAliases,
  registryRepoCollaborators,
  registryRepos,
  registryTags,
  registryTeamMembers,
  registryTeamRepos,
  registryTeams,
} from "@/lib/db/schema"

import { logEvent } from "./activity.ts"
import { repoRole, roleIn } from "./access.ts"
import { labels } from "./readme.ts"
import { ALIAS_DAYS, DESCRIPTION_MAX, atLeast, validRepoName, type Role } from "./rules.ts"

type Result = { error?: string }
type Grant = "read" | "write" | "admin"
const GRANTS: Grant[] = ["read", "write", "admin"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DESC = "org.opencontainers.image.description"

async function who(userId: string) {
  const [u] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId))
  return u?.name || u?.email || "A member"
}

async function load(repoId: string) {
  if (!UUID.test(repoId)) return null
  const [row] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, repoId), isNull(registryRepos.deletedAt)))
  return row ?? null
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>

// The repo plus the actor's role on it, or an error when it's gone or the role is too low.
async function need(actorUserId: string, repoId: string, min: Role): Promise<{ error: string } | { row: Loaded; name: string }> {
  const row = await load(repoId)
  const role = row && (await repoRole(actorUserId, row.ns, row.repo))
  if (!row || !role) return { error: "That repository doesn't exist." }
  if (!atLeast(role, min)) return { error: min === "write" ? "You need write access to this repository." : "You need admin access to this repository." }
  return { row, name: await who(actorUserId) }
}

const full = (r: Loaded) => `${r.ns.name}/${r.repo.name}`

async function record(actorUserId: string, name: string, row: Loaded, action: string, detail: Record<string, unknown>, text?: string) {
  await auditAs({ id: actorUserId, name }, `registry_${action}`, `${full(row)}: ${text ?? JSON.stringify(detail)}`)
  await logEvent({ namespaceId: row.ns.id, repoId: row.repo.id, actorId: actorUserId, actorName: name, action, detail })
}

// ---- collaborators ----

export async function listCollaborators(repoId: string) {
  return db
    .select({ userId: user.id, name: user.name, email: user.email, role: registryRepoCollaborators.role })
    .from(registryRepoCollaborators)
    .innerJoin(user, eq(user.id, registryRepoCollaborators.userId))
    .where(eq(registryRepoCollaborators.repoId, repoId))
    .orderBy(asc(user.name))
}

export async function addCollaborator(actorUserId: string, repoId: string, email: string, role: string): Promise<Result> {
  if (!GRANTS.includes(role as Grant)) return { error: "Pick a role." }
  const n = await need(actorUserId, repoId, "admin")
  if ("error" in n) return n
  const [target] = await db
    .select({ id: user.id, status: user.status, off: user.registryDisabled })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
  if (!target || target.status !== "active") return { error: "No member of this Nimbus has that email." }
  if (target.off) return { error: "An admin turned the registry off for that member." }
  if ((await roleIn(target.id, n.row.ns)) === "owner") return { error: "They already own this repository." }
  await db
    .insert(registryRepoCollaborators)
    .values({ repoId, userId: target.id, role: role as Grant })
    .onConflictDoUpdate({ target: [registryRepoCollaborators.repoId, registryRepoCollaborators.userId], set: { role: role as Grant } })
  await record(actorUserId, n.name, n.row, "collaborator_add", { userId: target.id, email: email.trim(), role })
  return {}
}

export async function setCollaboratorRole(actorUserId: string, repoId: string, userId: string, role: string): Promise<Result> {
  if (!GRANTS.includes(role as Grant)) return { error: "Pick a role." }
  const n = await need(actorUserId, repoId, "admin")
  if ("error" in n) return n
  const done = await db
    .update(registryRepoCollaborators)
    .set({ role: role as Grant })
    .where(and(eq(registryRepoCollaborators.repoId, repoId), eq(registryRepoCollaborators.userId, userId)))
    .returning({ u: registryRepoCollaborators.userId })
  if (!done.length) return { error: "They aren't a collaborator." }
  await record(actorUserId, n.name, n.row, "collaborator_role", { userId, role })
  return {}
}

export async function removeCollaborator(actorUserId: string, repoId: string, userId: string): Promise<Result> {
  const n = await need(actorUserId, repoId, "admin")
  if ("error" in n) return n
  const done = await db
    .delete(registryRepoCollaborators)
    .where(and(eq(registryRepoCollaborators.repoId, repoId), eq(registryRepoCollaborators.userId, userId)))
    .returning({ u: registryRepoCollaborators.userId })
  if (!done.length) return { error: "They aren't a collaborator." }
  await record(actorUserId, n.name, n.row, "collaborator_remove", { userId })
  return {}
}

// ---- teams (org owners only) ----

async function orgNamespace(actorUserId: string, orgId: string) {
  if (!UUID.test(orgId)) return null
  const [ns] = await db.select().from(registryNamespaces).where(and(eq(registryNamespaces.kind, "org"), eq(registryNamespaces.refId, orgId)))
  return ns && (await roleIn(actorUserId, ns)) === "owner" ? ns : null
}

const NOT_OWNER = { error: "Only an org owner can manage teams." }

async function teamNs(actorUserId: string, teamId: string) {
  if (!UUID.test(teamId)) return null
  const [t] = await db.select().from(registryTeams).where(eq(registryTeams.id, teamId))
  const ns = t && (await orgNamespace(actorUserId, t.orgId))
  return t && ns ? { team: t, ns } : null
}

export async function listTeams(orgId: string) {
  const teams = await db.select().from(registryTeams).where(eq(registryTeams.orgId, orgId)).orderBy(asc(registryTeams.name))
  const members = await db
    .select({ teamId: registryTeamMembers.teamId, userId: user.id, name: user.name, email: user.email })
    .from(registryTeamMembers)
    .innerJoin(user, eq(user.id, registryTeamMembers.userId))
    .innerJoin(registryTeams, eq(registryTeams.id, registryTeamMembers.teamId))
    .where(eq(registryTeams.orgId, orgId))
  const repos = await db
    .select({ teamId: registryTeamRepos.teamId, repoId: registryTeamRepos.repoId, name: registryRepos.name, role: registryTeamRepos.role })
    .from(registryTeamRepos)
    .innerJoin(registryRepos, eq(registryRepos.id, registryTeamRepos.repoId))
    .innerJoin(registryTeams, eq(registryTeams.id, registryTeamRepos.teamId))
    .where(eq(registryTeams.orgId, orgId))
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    members: members.filter((m) => m.teamId === t.id).map(({ userId, name, email }) => ({ userId, name, email })),
    repos: repos.filter((r) => r.teamId === t.id).map(({ repoId, name, role }) => ({ repoId, name, role })),
  }))
}

const teamName = (s: string) => {
  const n = s.trim()
  return n.length >= 1 && n.length <= 40 ? n : null
}

export async function createTeam(actorUserId: string, orgId: string, name: string): Promise<Result & { id?: string }> {
  const ns = await orgNamespace(actorUserId, orgId)
  if (!ns) return NOT_OWNER
  const n = teamName(name)
  if (!n) return { error: "Team names are 1 to 40 characters." }
  const [made] = await db.insert(registryTeams).values({ orgId, name: n }).onConflictDoNothing().returning({ id: registryTeams.id })
  if (!made) return { error: "A team with that name already exists." }
  const actor = await who(actorUserId)
  await auditAs({ id: actorUserId, name: actor }, "registry_team_create", `${ns.name}: ${n}`)
  await logEvent({ namespaceId: ns.id, actorId: actorUserId, actorName: actor, action: "team_create", detail: { team: n } })
  return { id: made.id }
}

export async function renameTeam(actorUserId: string, teamId: string, name: string): Promise<Result> {
  const t = await teamNs(actorUserId, teamId)
  if (!t) return NOT_OWNER
  const n = teamName(name)
  if (!n) return { error: "Team names are 1 to 40 characters." }
  const [clash] = await db
    .select({ id: registryTeams.id })
    .from(registryTeams)
    .where(and(eq(registryTeams.orgId, t.team.orgId), sql`lower(${registryTeams.name}) = ${n.toLowerCase()}`, ne(registryTeams.id, teamId)))
  if (clash) return { error: "A team with that name already exists." }
  await db.update(registryTeams).set({ name: n }).where(eq(registryTeams.id, teamId))
  const actor = await who(actorUserId)
  await auditAs({ id: actorUserId, name: actor }, "registry_team_rename", `${t.ns.name}: ${t.team.name} → ${n}`)
  await logEvent({ namespaceId: t.ns.id, actorId: actorUserId, actorName: actor, action: "team_rename", detail: { from: t.team.name, to: n } })
  return {}
}

export async function deleteTeam(actorUserId: string, teamId: string): Promise<Result> {
  const t = await teamNs(actorUserId, teamId)
  if (!t) return NOT_OWNER
  await db.delete(registryTeams).where(eq(registryTeams.id, teamId))
  const actor = await who(actorUserId)
  await auditAs({ id: actorUserId, name: actor }, "registry_team_delete", `${t.ns.name}: ${t.team.name}`)
  await logEvent({ namespaceId: t.ns.id, actorId: actorUserId, actorName: actor, action: "team_delete", detail: { team: t.team.name } })
  return {}
}

export async function addTeamMember(actorUserId: string, teamId: string, userId: string): Promise<Result> {
  const t = await teamNs(actorUserId, teamId)
  if (!t) return NOT_OWNER
  const [m] = await db
    .select({ r: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, t.team.orgId), eq(registryOrgMembers.userId, userId)))
  if (!m) return { error: "Only org members can join a team. Add them to the org first." }
  await db.insert(registryTeamMembers).values({ teamId, userId }).onConflictDoNothing()
  const actor = await who(actorUserId)
  await auditAs({ id: actorUserId, name: actor }, "registry_team_member_add", `${t.ns.name}/${t.team.name}: ${await who(userId)}`)
  await logEvent({ namespaceId: t.ns.id, actorId: actorUserId, actorName: actor, action: "team_member_add", detail: { team: t.team.name, userId } })
  return {}
}

export async function removeTeamMember(actorUserId: string, teamId: string, userId: string): Promise<Result> {
  const t = await teamNs(actorUserId, teamId)
  if (!t) return NOT_OWNER
  await db.delete(registryTeamMembers).where(and(eq(registryTeamMembers.teamId, teamId), eq(registryTeamMembers.userId, userId)))
  const actor = await who(actorUserId)
  await auditAs({ id: actorUserId, name: actor }, "registry_team_member_remove", `${t.ns.name}/${t.team.name}: ${await who(userId)}`)
  await logEvent({ namespaceId: t.ns.id, actorId: actorUserId, actorName: actor, action: "team_member_remove", detail: { team: t.team.name, userId } })
  return {}
}

// role null removes the team's access to the repo.
export async function setTeamRepo(actorUserId: string, teamId: string, repoId: string, role: string | null): Promise<Result> {
  const t = await teamNs(actorUserId, teamId)
  if (!t) return NOT_OWNER
  if (role !== null && !GRANTS.includes(role as Grant)) return { error: "Pick a role." }
  const row = await load(repoId)
  if (!row || row.ns.id !== t.ns.id) return { error: "That repository isn't in this org." }
  if (role === null) await db.delete(registryTeamRepos).where(and(eq(registryTeamRepos.teamId, teamId), eq(registryTeamRepos.repoId, repoId)))
  else
    await db
      .insert(registryTeamRepos)
      .values({ teamId, repoId, role: role as Grant })
      .onConflictDoUpdate({ target: [registryTeamRepos.teamId, registryTeamRepos.repoId], set: { role: role as Grant } })
  await record(actorUserId, await who(actorUserId), row, "team_repo", { team: t.team.name, role }, `${t.team.name} ${role ?? "removed"}`)
  return {}
}

export async function teamsForRepo(repoId: string) {
  return db
    .select({ teamId: registryTeams.id, name: registryTeams.name, role: registryTeamRepos.role })
    .from(registryTeamRepos)
    .innerJoin(registryTeams, eq(registryTeams.id, registryTeamRepos.teamId))
    .where(eq(registryTeamRepos.repoId, repoId))
    .orderBy(asc(registryTeams.name))
}

// ---- rename / move ----

export async function renameRepo(actorUserId: string, repoId: string, to: { namespace: string; name: string }): Promise<{ error?: string; fullName?: string }> {
  const n = await need(actorUserId, repoId, "admin")
  if ("error" in n) return n
  const { repo, ns } = n.row
  const name = to.name.trim()
  if (!validRepoName(name)) return { error: "Use lowercase letters, numbers, dots, hyphens and underscores, with slashes between parts." }
  const [target] = await db.select().from(registryNamespaces).where(sql`lower(${registryNamespaces.name}) = ${to.namespace.trim().toLowerCase()}`)
  if (!target) return { error: "That namespace doesn't exist." }
  const moving = target.id !== ns.id
  if (moving && ((await roleIn(actorUserId, target)) !== "owner" || (await roleIn(actorUserId, ns)) !== "owner"))
    return { error: "You can only move a repository between namespaces you own." }
  if (!moving && name === repo.name) return { error: "That's already its name." }
  // Any repo row (trash included, the unique index counts it) or a live alias of another repo holds the name.
  const [taken] = await db
    .select({ id: registryRepos.id })
    .from(registryRepos)
    .where(and(eq(registryRepos.namespaceId, target.id), sql`lower(${registryRepos.name}) = ${name.toLowerCase()}`, ne(registryRepos.id, repoId)))
  if (taken) return { error: "A repository with that name already exists there (maybe in its trash)." }
  const [alias] = await db
    .select({ id: registryRepoAliases.id })
    .from(registryRepoAliases)
    .where(
      and(
        eq(registryRepoAliases.namespaceId, target.id),
        sql`lower(${registryRepoAliases.name}) = ${name.toLowerCase()}`,
        ne(registryRepoAliases.repoId, repoId),
        gt(registryRepoAliases.expiresAt, new Date())
      )
    )
  if (alias) return { error: "That name was used by another repository recently and is held for a while." }
  const expiresAt = new Date(Date.now() + ALIAS_DAYS * 86_400_000)
  await db.transaction(async (tx) => {
    // Free the new name (an expired alias, or this repo's own old alias) and keep the old one.
    await tx
      .delete(registryRepoAliases)
      .where(and(eq(registryRepoAliases.namespaceId, target.id), sql`lower(${registryRepoAliases.name}) = ${name.toLowerCase()}`))
    await tx
      .delete(registryRepoAliases)
      .where(and(eq(registryRepoAliases.namespaceId, ns.id), sql`lower(${registryRepoAliases.name}) = ${repo.name.toLowerCase()}`))
    await tx.insert(registryRepoAliases).values({ namespaceId: ns.id, name: repo.name, repoId, expiresAt })
    await tx.update(registryRepos).set({ namespaceId: target.id, name }).where(eq(registryRepos.id, repoId))
    if (moving) {
      await tx.update(registryHooks).set({ namespaceId: target.id }).where(eq(registryHooks.repoId, repoId))
      // Teams belong to the old org; their grants don't follow the repo.
      await tx.delete(registryTeamRepos).where(eq(registryTeamRepos.repoId, repoId))
    }
  })
  const from = `${ns.name}/${repo.name}`
  const fullName = `${target.name}/${name}`
  await auditAs({ id: actorUserId, name: n.name }, "registry_repo_rename", `${from} → ${fullName}`)
  const detail = { from, to: fullName }
  await logEvent({ namespaceId: ns.id, repoId, actorId: actorUserId, actorName: n.name, action: "rename", detail })
  if (moving) await logEvent({ namespaceId: target.id, repoId, actorId: actorUserId, actorName: n.name, action: "rename", detail })
  return { fullName }
}

// The live alias for the "was ns/old" banner: the old name and when it stops working.
export async function aliasFor(repoId: string): Promise<{ fullName: string; expiresAt: Date } | null> {
  const [a] = await db
    .select({ ns: registryNamespaces.name, name: registryRepoAliases.name, expiresAt: registryRepoAliases.expiresAt })
    .from(registryRepoAliases)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepoAliases.namespaceId))
    .where(and(eq(registryRepoAliases.repoId, repoId), gt(registryRepoAliases.expiresAt, new Date())))
    .orderBy(desc(registryRepoAliases.expiresAt))
    .limit(1)
  return a ? { fullName: `${a.ns}/${a.name}`, expiresAt: a.expiresAt } : null
}

export async function purgeAliases(): Promise<number> {
  const gone = await db.delete(registryRepoAliases).where(sql`${registryRepoAliases.expiresAt} <= now()`).returning({ id: registryRepoAliases.id })
  return gone.length
}

// ---- archive and description ----

export async function setArchived(actorUserId: string, repoId: string, archived: boolean): Promise<Result> {
  const n = await need(actorUserId, repoId, "admin")
  if ("error" in n) return n
  await db.update(registryRepos).set({ archivedAt: archived ? new Date() : null }).where(eq(registryRepos.id, repoId))
  await record(actorUserId, n.name, n.row, archived ? "archive" : "unarchive", {}, archived ? "archived" : "unarchived")
  return {}
}

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX) || null

// The image's own description for a tag's digest (config label or manifest annotation).
async function fromImage(repoId: string, digest: string) {
  const l = await labels(repoId, digest)
  return l?.[DESC] ? clip(l[DESC]) : null
}

// After a tag push: follow the image's description unless someone typed one. A missing label keeps the old text.
export async function refreshDescription(repoId: string, digest: string): Promise<void> {
  try {
    const [r] = await db.select({ custom: registryRepos.descriptionCustom }).from(registryRepos).where(eq(registryRepos.id, repoId))
    if (!r || r.custom) return
    const d = await fromImage(repoId, digest)
    if (d) await db.update(registryRepos).set({ description: d }).where(eq(registryRepos.id, repoId))
  } catch (e) {
    console.error("[registry] description:", e)
  }
}

// null (or blank) goes back to the latest tag's label.
export async function setDescription(actorUserId: string, repoId: string, text: string | null): Promise<Result> {
  const n = await need(actorUserId, repoId, "write")
  if ("error" in n) return n
  const t = text?.replace(/\s+/g, " ").trim()
  if (t && t.length > DESCRIPTION_MAX) return { error: `The description can be ${DESCRIPTION_MAX} characters at most.` }
  if (t) await db.update(registryRepos).set({ description: t, descriptionCustom: true }).where(eq(registryRepos.id, repoId))
  else {
    const [tag] = await db
      .select({ digest: registryTags.digest })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, repoId), isNull(registryTags.deletedAt)))
      .orderBy(desc(registryTags.pushedAt))
      .limit(1)
    const d = tag ? await fromImage(repoId, tag.digest).catch(() => null) : null
    await db.update(registryRepos).set({ description: d, descriptionCustom: false }).where(eq(registryRepos.id, repoId))
  }
  await record(actorUserId, n.name, n.row, "description", { text: t || null }, t ? "edited" : "reset to the image label")
  return {}
}
