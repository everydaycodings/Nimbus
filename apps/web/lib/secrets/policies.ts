// Project-level governance settings: which environments are protected and who
// approves, and the keys every environment must have.
import "server-only"

import { and, asc, eq, inArray } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretEnvs, secretMembers, secretRequiredKeys, user } from "@/lib/db/schema"
import { KEY_RE } from "./format"
import { validPattern, type SchemaKind } from "./gov-rules"
import { SecretsError, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)

export async function updateEnvPolicy(
  c: Ctx,
  envId: string,
  p: { protected: boolean; approvalsRequired: number; approverIds: string[] | null; adminBypass: boolean }
) {
  const [e] = await db
    .select()
    .from(secretEnvs)
    .where(and(eq(secretEnvs.id, envId), eq(secretEnvs.projectId, c.projectId)))
  if (!e) throw bad("That environment doesn't exist.", 404)
  const members = await db
    .select({ u: secretMembers.userId, role: secretMembers.role })
    .from(secretMembers)
    .where(eq(secretMembers.projectId, c.projectId))
  const ids = p.approverIds ? [...new Set(p.approverIds.filter((x) => members.some((m) => m.u === x)))] : null
  const pool = ids?.length ? ids.length : members.filter((m) => m.role === "admin").length
  const approvals = Math.min(10, Math.max(1, Math.floor(p.approvalsRequired) || 1))
  // Nobody can approve their own change, so the pool must be bigger than the bar.
  if (p.protected && approvals > pool) throw bad(`Only ${pool} ${pool === 1 ? "person can" : "people can"} approve, so it can't require ${approvals}.`)
  await db
    .update(secretEnvs)
    .set({ protected: p.protected, approvalsRequired: approvals, approverIds: ids?.length ? ids : null, adminBypass: p.adminBypass })
    .where(eq(secretEnvs.id, envId))
  await audit("secrets_env_policy", {
    detail: p.protected
      ? `${e.name} protected: ${approvals} approval${approvals === 1 ? "" : "s"}${ids?.length ? ` from ${ids.length} chosen` : " from admins"}${p.adminBypass ? ", admins can bypass" : ""}`
      : `${e.name} no longer protected`,
    env: e.name,
  })
}

export async function listMembersLite(c: Ctx) {
  return db
    .select({ id: user.id, name: user.name, role: secretMembers.role })
    .from(secretMembers)
    .innerJoin(user, eq(user.id, secretMembers.userId))
    .where(eq(secretMembers.projectId, c.projectId))
    .orderBy(asc(user.name))
}

export async function listRequired(c: Ctx) {
  return db
    .select({ key: secretRequiredKeys.key, kind: secretRequiredKeys.kind, pattern: secretRequiredKeys.pattern })
    .from(secretRequiredKeys)
    .where(eq(secretRequiredKeys.projectId, c.projectId))
    .orderBy(asc(secretRequiredKeys.key))
}

export async function setRequired(c: Ctx, key: string, kind: SchemaKind, pattern: string | null) {
  const k = key.trim()
  if (!KEY_RE.test(k)) throw bad("Keys use letters, numbers and _, and can't start with a number.")
  if (!["any", "url", "int", "regex"].includes(kind)) throw bad("Pick a format.")
  const pat = kind === "regex" ? (pattern ?? "").trim() : null
  if (kind === "regex" && !pat) throw bad("Give the pattern the value must match.")
  if (pat && !validPattern(pat)) throw bad("That pattern isn't a valid regular expression (200 characters at most).")
  await db
    .insert(secretRequiredKeys)
    .values({ projectId: c.projectId, key: k, kind, pattern: pat })
    .onConflictDoUpdate({ target: [secretRequiredKeys.projectId, secretRequiredKeys.key], set: { kind, pattern: pat } })
  await audit("secrets_required_key", { detail: `${k} is required in every environment${kind === "any" ? "" : ` as ${kind}${pat ? ` ${pat}` : ""}`}` })
}

export async function removeRequired(c: Ctx, key: string) {
  await db.delete(secretRequiredKeys).where(and(eq(secretRequiredKeys.projectId, c.projectId), inArray(secretRequiredKeys.key, [key])))
  await audit("secrets_required_key", { detail: `${key} is no longer required` })
}
