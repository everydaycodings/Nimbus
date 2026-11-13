// Who is in a project, with what role and which environments. Members only: people
// who already have a Nimbus account (outsiders get share links or tokens).
import "server-only"

import { and, asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { secretEnvs, secretMembers, user } from "@/lib/db/schema"
import { SecretsError, type Ctx, type Role } from "./service"

const ROLES: Role[] = ["admin", "developer", "viewer"]

export async function listMembers(c: Ctx) {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: secretMembers.role,
      envIds: secretMembers.envIds,
    })
    .from(secretMembers)
    .innerJoin(user, eq(user.id, secretMembers.userId))
    .where(eq(secretMembers.projectId, c.projectId))
    .orderBy(asc(user.name))
  return rows.map((r) => ({ ...r, envIds: r.role === "admin" ? null : r.envIds }))
}

async function checked(c: Ctx, role: string, envIds: string[] | null): Promise<[Role, string[] | null]> {
  if (!ROLES.includes(role as Role)) throw new SecretsError(400, "Pick a role.")
  if (role === "admin" || envIds === null) return [role as Role, null]
  const have = await db.select({ id: secretEnvs.id }).from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId))
  const ids = envIds.filter((e) => have.some((h) => h.id === e))
  if (!ids.length) throw new SecretsError(400, "Pick at least one environment.")
  return [role as Role, ids]
}

export async function addMember(c: Ctx, email: string, role: string, envIds: string[] | null) {
  const [r, envs] = await checked(c, role, envIds)
  const [u] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.email, email.trim().toLowerCase()), eq(user.status, "active")))
  if (!u) throw new SecretsError(404, "No Nimbus member has that email.")
  const [had] = await db
    .select({ u: secretMembers.userId })
    .from(secretMembers)
    .where(and(eq(secretMembers.projectId, c.projectId), eq(secretMembers.userId, u.id)))
  if (had) throw new SecretsError(409, `${u.name} is already in this project.`)
  await db.insert(secretMembers).values({ projectId: c.projectId, userId: u.id, role: r, envIds: envs })
  return u
}

// Nobody can leave a project with no admin.
async function keepAnAdmin(c: Ctx, userId: string) {
  const admins = await db
    .select({ u: secretMembers.userId })
    .from(secretMembers)
    .where(and(eq(secretMembers.projectId, c.projectId), eq(secretMembers.role, "admin")))
  if (admins.length === 1 && admins[0].u === userId)
    throw new SecretsError(400, "A project needs at least one admin.")
}

export async function updateMember(c: Ctx, userId: string, role: string, envIds: string[] | null) {
  const [r, envs] = await checked(c, role, envIds)
  if (r !== "admin") await keepAnAdmin(c, userId)
  const [row] = await db
    .update(secretMembers)
    .set({ role: r, envIds: envs })
    .where(and(eq(secretMembers.projectId, c.projectId), eq(secretMembers.userId, userId)))
    .returning({ u: secretMembers.userId })
  if (!row) throw new SecretsError(404, "That person isn't in this project.")
}

export async function removeMember(c: Ctx, userId: string) {
  await keepAnAdmin(c, userId)
  await db
    .delete(secretMembers)
    .where(and(eq(secretMembers.projectId, c.projectId), eq(secretMembers.userId, userId)))
}

