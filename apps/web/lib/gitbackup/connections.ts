// Git Backup connections: a GitHub token kept for backups (PAT or OAuth), or a Registry connection the member manages.
// Tokens are sealed with lib/crypto.ts and never returned from here except by jobToken (the runner).
import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { gitBackupConnections, gitBackupJobs, registryGitConnections } from "@/lib/db/schema"
import { listConnections as registryConnections, secretOf } from "@/lib/registry/connections"
import * as github from "./github.ts"

type Row = typeof gitBackupConnections.$inferSelect

export type ConnView = {
  id: string
  provider: "github"
  name: string
  account: string | null
  host: string | null
  via: "pat" | "oauth"
  last4: string
  scopes: string[]
  expiresAt: string | null
  jobs: number
}
export type RegistryPick = { id: string; name: string; account: string | null; host: string | null; owner: string; expiresAt: string | null }
export type Ref = { connectionId: string; registryConnectionId?: never } | { registryConnectionId: string; connectionId?: never }

// "git.example.com" from what was typed; null for github.com or nothing.
export function cleanHost(h: string | null | undefined): { host: string | null } | { error: string } {
  const s = (h ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase()
  if (!s || s === "github.com") return { host: null }
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(s) ? { host: s } : { error: "Enter the server address like github.example.com." }
}

const cleanName = (raw: string) => {
  const n = raw.trim().replace(/\s+/g, " ")
  return n && n.length <= 60 ? n : null
}

export async function listConnections(userId: string): Promise<ConnView[]> {
  const rows = await db.select().from(gitBackupConnections).where(eq(gitBackupConnections.userId, userId)).orderBy(asc(gitBackupConnections.name))
  const used = await db
    .select({ id: gitBackupJobs.connectionId, n: sql<number>`count(*)::int` })
    .from(gitBackupJobs)
    .where(eq(gitBackupJobs.userId, userId))
    .groupBy(gitBackupJobs.connectionId)
  return rows.map((c) => ({
    id: c.id,
    provider: "github",
    name: c.name,
    account: c.account,
    host: c.host,
    via: c.via,
    last4: c.last4,
    scopes: c.scopes,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    jobs: used.find((u) => u.id === c.id)?.n ?? 0,
  }))
}

// Registry connections this member manages (GitHub only), no secrets.
export async function listRegistryConnections(userId: string): Promise<RegistryPick[]> {
  return (await registryConnections(userId))
    .filter((c) => c.canManage && c.provider === "github")
    .map((c) => ({ id: c.id, name: c.name, account: c.account, host: c.host && c.host !== "github.com" ? c.host : null, owner: c.owner, expiresAt: c.expiresAt }))
}

// The token and host behind a connection the member owns or manages; used by the picker and job checks.
// The cache key carries the member too: a Registry connection can be managed by several members.
export async function connCfg(userId: string, ref: Ref): Promise<{ token: string; host: string | null; key: string } | { error: string }> {
  if (ref?.connectionId) {
    const c = await mine(userId, ref.connectionId)
    const token = c && decrypt(c.secretEnc)
    return c && token ? { token, host: c.host, key: `${userId}:c:${c.id}` } : { error: "That connection isn't here." }
  }
  const ok = typeof ref?.registryConnectionId === "string" && (await listRegistryConnections(userId)).some((c) => c.id === ref.registryConnectionId)
  const [c] = ok ? await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, ref.registryConnectionId!)) : []
  const token = c && secretOf(c)
  return c && token ? { token, host: c.host && c.host !== "github.com" ? c.host : null, key: `${userId}:r:${c.id}` } : { error: "That Registry connection isn't available to you." }
}

// For the runner: the token a job backs up with.
export async function jobToken(job: typeof gitBackupJobs.$inferSelect): Promise<{ provider: "github"; host: string | null; token: string }> {
  if (job.connectionId) {
    const [c] = await db.select().from(gitBackupConnections).where(eq(gitBackupConnections.id, job.connectionId))
    const token = c && decrypt(c.secretEnc)
    if (!c || !token) throw new Error("The job's connection is gone or its token can't be read.")
    void db.update(gitBackupConnections).set({ lastUsedAt: new Date() }).where(eq(gitBackupConnections.id, c.id)).catch(() => {})
    return { provider: "github", host: c.host, token }
  }
  // Only while the job's owner still manages it (an org owner can lose that role).
  const ok = job.registryConnectionId && (await listRegistryConnections(job.userId)).some((c) => c.id === job.registryConnectionId)
  const [c] = ok ? await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, job.registryConnectionId!)) : []
  const token = c && secretOf(c)
  if (!c || !token) throw new Error("The job's Registry connection is gone, no longer yours to manage, or its token can't be read.")
  return { provider: "github", host: c.host && c.host !== "github.com" ? c.host : null, token }
}

async function nameTaken(userId: string, name: string, except?: string) {
  const rows = await db.select({ id: gitBackupConnections.id }).from(gitBackupConnections).where(and(eq(gitBackupConnections.userId, userId), sql`lower(${gitBackupConnections.name}) = ${name.toLowerCase()}`))
  return rows.some((r) => r.id !== except)
}

// github.ts checks an Enterprise host's address before each call.
const check = (token: string, host: string | null) => github.whoami({ token, host })

export type Saved = { id?: string; account?: string; scopes?: string[]; expiresAt?: string | null; error?: string }

export async function createConnection(userId: string, v: { name?: string; token: string; host?: string; via?: "pat" | "oauth" }): Promise<Saved> {
  const token = String(v.token ?? "").trim()
  if (!token || token.length > 1000) return { error: "Paste the token." }
  const h = cleanHost(v.host)
  if ("error" in h) return h
  let who
  try {
    who = await check(token, h.host)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const name = cleanName(v.name || who.login)
  if (!name) return { error: "Give the connection a name of up to 60 characters." }
  if (await nameTaken(userId, name)) return { error: `You already have a connection called “${name}”.` }
  const [c] = await db
    .insert(gitBackupConnections)
    .values({ userId, provider: "github", name, account: who.login, host: h.host, via: v.via ?? "pat", secretEnc: encrypt(token), last4: token.slice(-4), scopes: who.scopes, expiresAt: who.expiresAt })
    .returning({ id: gitBackupConnections.id })
  await audit("git_backup_connection_create", { detail: `${name} (${who.login})` })
  return { id: c.id, account: who.login, scopes: who.scopes, expiresAt: who.expiresAt?.toISOString() ?? null }
}

async function mine(userId: string, id: string): Promise<Row | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const [c] = await db.select().from(gitBackupConnections).where(and(eq(gitBackupConnections.id, id), eq(gitBackupConnections.userId, userId)))
  return c ?? null
}

export async function renameConnection(userId: string, id: string, raw: string): Promise<{ error?: string }> {
  const c = await mine(userId, id)
  if (!c) return { error: "That connection isn't here." }
  const name = cleanName(raw)
  if (!name) return { error: "Give the connection a name of up to 60 characters." }
  if (await nameTaken(userId, name, id)) return { error: `You already have a connection called “${name}”.` }
  await db.update(gitBackupConnections).set({ name }).where(eq(gitBackupConnections.id, id))
  await audit("git_backup_connection_rename", { detail: `${c.name} → ${name}` })
  return {}
}

// Jobs using it pick the new token up at once.
export async function replaceToken(userId: string, id: string, raw: string): Promise<Saved> {
  const c = await mine(userId, id)
  if (!c) return { error: "That connection isn't here." }
  const token = String(raw ?? "").trim()
  if (!token || token.length > 1000) return { error: "Paste the token." }
  let who
  try {
    who = await check(token, c.host)
  } catch (e) {
    return { error: (e as Error).message }
  }
  if (c.account && who.login.toLowerCase() !== c.account.toLowerCase()) return { error: `That token belongs to ${who.login}, not ${c.account}. Add it as a new connection instead.` }
  await db.update(gitBackupConnections).set({ secretEnc: encrypt(token), last4: token.slice(-4), scopes: who.scopes, expiresAt: who.expiresAt, warnedAt: null }).where(eq(gitBackupConnections.id, id))
  await audit("git_backup_connection_replace", { detail: c.name })
  return { id, account: who.login, scopes: who.scopes, expiresAt: who.expiresAt?.toISOString() ?? null }
}

export async function deleteConnection(userId: string, id: string): Promise<{ error?: string }> {
  const c = await mine(userId, id)
  if (!c) return {}
  const jobs = await db.select({ name: gitBackupJobs.name }).from(gitBackupJobs).where(eq(gitBackupJobs.connectionId, id))
  if (jobs.length) return { error: `Used by ${jobs.map((j) => `“${j.name}”`).join(", ")}. Delete or move those jobs first.` }
  await db.delete(gitBackupConnections).where(eq(gitBackupConnections.id, id))
  await audit("git_backup_connection_delete", { detail: c.name })
  return {}
}
