// Saved git connections: a token or SSH key kept once, encrypted, and picked by any number of build sources.
// Personal ones live in the member's own namespace, org ones in the org's (org owners manage them; repo admins
// of that org can pick them without ever seeing the secret). Secrets are never returned from this file except
// to the build runner and webhook code through sourceCredential().
import "server-only"

import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryBuildSources, registryGitConnections, registryNamespaces, registryOrgMembers, registryRepos } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { redis } from "@/lib/redis"
import { checkUrl, dialable } from "@/lib/secrets/webhooks"

import { repoRole, roleIn } from "./access.ts"
import { logEvent } from "./activity.ts"
import { backfillKey, fits, LEGACY_NAME, PROVIDER_LABEL, PROVIDERS, splitLegacy, WARN_DAYS, daysLeft, type Provider } from "./connection-rules.ts"
import { namespaceOwners } from "./events.ts"
import * as github from "./github.ts"
import { atLeast } from "./rules.ts"

export { PROVIDERS, type Provider } from "./connection-rules.ts"

type Row = typeof registryGitConnections.$inferSelect
type Source = typeof registryBuildSources.$inferSelect
type Ns = typeof registryNamespaces.$inferSelect

export type UsedBy = { id: string; fullName: string }
export type ConnectionView = {
  id: string
  namespaceId: string
  // The registry name that owns it: yours, or an org's.
  owner: string
  ownerKind: "user" | "org"
  provider: Provider
  name: string
  username: string | null
  account: string | null
  host: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  canManage: boolean
  usedBy: number
  // Only for those who manage it.
  repos: UsedBy[]
}

const nameOf = async (userId: string) => (await db.select({ n: user.name }).from(user).where(eq(user.id, userId)))[0]?.n ?? "A member"

// What the member may manage here: their own namespace, or an org they own.
async function manageable(userId: string, namespaceId: string): Promise<Ns | null> {
  const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  if (!ns) return null
  return (await roleIn(userId, ns)) === "owner" ? ns : null
}

async function loadFor(userId: string, id: string): Promise<{ c: Row; ns: Ns } | { error: string }> {
  const [row] = await db
    .select({ c: registryGitConnections, ns: registryNamespaces })
    .from(registryGitConnections)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryGitConnections.namespaceId))
    .where(eq(registryGitConnections.id, id))
  if (!row) return { error: "That connection isn't here." }
  if ((await roleIn(userId, row.ns)) !== "owner") return { error: "Only the owner of this connection can change it." }
  return row
}

async function record(actor: string, ns: Ns, c: { id: string; name: string; provider: Provider }, what: string, extra: Record<string, unknown> = {}) {
  const name = await nameOf(actor)
  await auditAs({ id: actor, name }, `registry_connection_${what}`, `${ns.name}: ${c.name} (${PROVIDER_LABEL[c.provider]})`)
  await logEvent({ namespaceId: ns.id, actorId: actor, actorName: name, action: "connection", detail: { what, name: c.name, provider: c.provider, ...extra } })
}

// ---- reading ----------------------------------------------------------------------------------------------

export async function usage(connectionId: string): Promise<UsedBy[]> {
  const rows = await db
    .select({ id: registryRepos.id, repo: registryRepos.name, ns: registryNamespaces.name })
    .from(registryBuildSources)
    .innerJoin(registryRepos, eq(registryRepos.id, registryBuildSources.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryBuildSources.connectionId, connectionId), isNull(registryRepos.deletedAt)))
    .orderBy(asc(registryNamespaces.name), asc(registryRepos.name))
  return rows.map((r) => ({ id: r.id, fullName: `${r.ns}/${r.repo}` }))
}

// Personal connections, then those of each org the member belongs to. Owners manage theirs; a repo admin of the
// org sees names only (no used-by list, no menu).
export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const orgs = await db
    .select({ ns: registryNamespaces, role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .innerJoin(registryNamespaces, and(eq(registryNamespaces.kind, "org"), eq(registryNamespaces.refId, sql`${registryOrgMembers.orgId}::text`)))
    .where(eq(registryOrgMembers.userId, userId))
  const [mine] = await db.select().from(registryNamespaces).where(and(eq(registryNamespaces.kind, "user"), eq(registryNamespaces.refId, userId)))
  const scope: { ns: Ns; manage: boolean }[] = mine ? [{ ns: mine, manage: true }] : []
  for (const o of orgs) {
    if (o.role === "owner") scope.push({ ns: o.ns, manage: true })
    else if (await isRepoAdminIn(userId, o.ns)) scope.push({ ns: o.ns, manage: false })
  }
  if (!scope.length) return []
  const rows = await db
    .select()
    .from(registryGitConnections)
    .where(inArray(registryGitConnections.namespaceId, scope.map((s) => s.ns.id)))
    .orderBy(asc(registryGitConnections.name))
  const used = new Map<string, UsedBy[]>()
  for (const c of rows) used.set(c.id, await usage(c.id))
  return scope.flatMap(({ ns, manage }) =>
    rows
      .filter((c) => c.namespaceId === ns.id)
      .map((c) => ({
        id: c.id,
        namespaceId: ns.id,
        owner: ns.name,
        ownerKind: ns.kind,
        provider: c.provider,
        name: c.name,
        username: c.username,
        account: c.account,
        host: c.host,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        canManage: manage,
        usedBy: used.get(c.id)!.length,
        repos: manage ? used.get(c.id)! : [],
      }))
  )
}

async function isRepoAdminIn(userId: string, ns: Ns): Promise<boolean> {
  const repos = await db.select({ id: registryRepos.id }).from(registryRepos).where(and(eq(registryRepos.namespaceId, ns.id), isNull(registryRepos.deletedAt))).limit(200)
  for (const r of repos) if (atLeast(await repoRole(userId, ns, r), "admin")) return true
  return false
}

// Namespaces whose connections a repo admin may pick for this repo: their own, and the repo's org.
async function pickable(userId: string, repoId: string): Promise<{ ns: Ns; mine: boolean }[] | null> {
  const [row] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, repoId), isNull(registryRepos.deletedAt)))
  if (!row || !atLeast(await repoRole(userId, row.ns, row.repo), "admin")) return null
  const [mine] = await db.select().from(registryNamespaces).where(and(eq(registryNamespaces.kind, "user"), eq(registryNamespaces.refId, userId)))
  const out = mine ? [{ ns: mine, mine: true }] : []
  if (row.ns.kind === "org" && row.ns.id !== mine?.id) out.push({ ns: row.ns, mine: false })
  return out
}

export type ConnectionPick = { id: string; name: string; provider: Provider; account: string | null; host: string | null; owner: string; expiresAt: string | null }

// The connections this member can put on this repo, no secrets. `kind`: github sources take GitHub tokens only.
export async function connectionsFor(userId: string, repoId: string, kind: "github" | "git"): Promise<ConnectionPick[]> {
  const spaces = await pickable(userId, repoId)
  if (!spaces) return []
  const rows = await db
    .select()
    .from(registryGitConnections)
    .where(inArray(registryGitConnections.namespaceId, spaces.map((s) => s.ns.id)))
    .orderBy(asc(registryGitConnections.name))
  const owner = new Map(spaces.map((s) => [s.ns.id, s.mine ? "You" : s.ns.name]))
  return rows
    .filter((c) => (kind === "github" ? c.provider === "github" : c.provider !== "github"))
    .map((c) => ({ id: c.id, name: c.name, provider: c.provider, account: c.account, host: c.host, owner: owner.get(c.namespaceId)!, expiresAt: c.expiresAt?.toISOString() ?? null }))
}

// The connection if this member may use it on this repo (right owner, right kind of source).
export async function usable(userId: string, repoId: string, connectionId: string, source: { kind: "github" | "git"; url: string }): Promise<Row | { error: string }> {
  const spaces = await pickable(userId, repoId)
  if (!spaces) return { error: "You need to be an admin of this repository." }
  const [c] = await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, connectionId))
  if (!c || !spaces.some((s) => s.ns.id === c.namespaceId)) return { error: "That connection isn't available for this repository." }
  if (!fits(c.provider, source)) return { error: `A ${PROVIDER_LABEL[c.provider]} connection doesn't fit this repository's address.` }
  return c
}

// The member's namespaces a connection can be saved into, for the picker in the dialogs.
export async function ownersFor(userId: string): Promise<{ id: string; name: string; label: string }[]> {
  const [mine] = await db.select().from(registryNamespaces).where(and(eq(registryNamespaces.kind, "user"), eq(registryNamespaces.refId, userId)))
  const orgs = await db
    .select({ ns: registryNamespaces })
    .from(registryOrgMembers)
    .innerJoin(registryNamespaces, and(eq(registryNamespaces.kind, "org"), eq(registryNamespaces.refId, sql`${registryOrgMembers.orgId}::text`)))
    .where(and(eq(registryOrgMembers.userId, userId), eq(registryOrgMembers.role, "owner")))
  return [...(mine ? [{ id: mine.id, name: mine.name, label: "You" }] : []), ...orgs.map((o) => ({ id: o.ns.id, name: o.ns.name, label: o.ns.name }))]
}

// ---- validating --------------------------------------------------------------------------------------------

export type Checked = { account: string | null; expiresAt: Date | null; host: string | null; error?: string }

function cleanHost(h: string | undefined): string | null {
  const s = (h ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
  return /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s) ? s.toLowerCase() : null
}

async function apiGet(url: string, headers: Record<string, string>) {
  const u = checkUrl(url)
  await dialable(u)
  // No redirects: a redirect could point somewhere that was never checked.
  return fetch(u, { headers: { accept: "application/json", "user-agent": "nimbus-registry", ...headers }, redirect: "manual", signal: AbortSignal.timeout(10_000) })
}

// Checks the secret where it can, and finds out whose it is. GitHub must answer; GitLab and Gitea are asked
// when a host is given and only a refusal counts against the token (a server we can't reach isn't an error).
export async function validate(p: { provider: Provider; host?: string; secret: string }): Promise<Checked> {
  const host = cleanHost(p.host)
  const none = { account: null, expiresAt: null, host }
  if (p.provider === "github") {
    try {
      const w = await github.whoami(p.secret)
      return { account: w.login, expiresAt: w.expiresAt, host: "github.com" }
    } catch (e) {
      return { ...none, host: "github.com", error: (e as Error).message }
    }
  }
  if (p.provider === "ssh") {
    if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(p.secret) || p.secret.length > 16_000) return { ...none, error: "That doesn't look like an SSH private key." }
    return none
  }
  if (p.provider === "gitlab" || p.provider === "gitea") {
    if (!host) return { ...none, error: `Enter the address of your ${PROVIDER_LABEL[p.provider]} server, like git.example.com.` }
    try {
      if (p.provider === "gitlab") {
        const r = await apiGet(`https://${host}/api/v4/user`, { "private-token": p.secret })
        if (r.status === 401) return { ...none, error: "GitLab didn't accept that token." }
        if (!r.ok) return none
        const account = ((await r.json().catch(() => ({}))) as { username?: string }).username ?? null
        const self = await apiGet(`https://${host}/api/v4/personal_access_tokens/self`, { "private-token": p.secret }).catch(() => null)
        const exp = self?.ok ? ((await self.json().catch(() => ({}))) as { expires_at?: string | null }).expires_at : null
        return { account, expiresAt: exp ? new Date(`${exp}T23:59:59Z`) : null, host }
      }
      const r = await apiGet(`https://${host}/api/v1/user`, { authorization: `token ${p.secret}` })
      if (r.status === 401) return { ...none, error: "Gitea didn't accept that token." }
      return { ...none, account: r.ok ? (((await r.json().catch(() => ({}))) as { login?: string }).login ?? null) : null }
    } catch (e) {
      // checkUrl/dialable refuse private or invalid addresses with a readable message; plain network failures are not errors.
      return /private|address|URL|host|http/i.test((e as Error).message) ? { ...none, error: (e as Error).message } : none
    }
  }
  return none
}

// ---- changing ----------------------------------------------------------------------------------------------

export type NewConnection = { namespaceId: string; provider: Provider; name: string; username?: string; host?: string; secret: string }

function cleanName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, " ")
  return n && n.length <= 60 ? n : null
}

const sealed = (p: Provider, secret: string) => encrypt(p === "ssh" ? `${secret.trim()}\n` : secret.trim())

async function nameTaken(namespaceId: string, name: string, except?: string) {
  const rows = await db
    .select({ id: registryGitConnections.id })
    .from(registryGitConnections)
    .where(and(eq(registryGitConnections.namespaceId, namespaceId), sql`lower(${registryGitConnections.name}) = ${name.toLowerCase()}`))
  return rows.some((r) => r.id !== except)
}

export async function createConnection(actorUserId: string, v: NewConnection): Promise<{ id?: string; account?: string | null; expiresAt?: string | null; error?: string }> {
  const ns = await manageable(actorUserId, v.namespaceId)
  if (!ns) return { error: "You can only add connections to your own name or an org you own." }
  if (!PROVIDERS.includes(v.provider)) return { error: "Pick where the credential is for." }
  const secret = String(v.secret ?? "").trim()
  if (!secret || secret.length > 16_000) return { error: v.provider === "ssh" ? "Paste the private key." : "Enter the token." }
  const checked = await validate({ provider: v.provider, host: v.host, secret })
  if (checked.error) return { error: checked.error }
  if ((v.provider === "gitlab" || v.provider === "gitea") && !checked.host) return { error: "Enter the server address, like git.example.com." }
  const name = cleanName(v.name || checked.account || "")
  if (!name) return { error: "Give the connection a name of up to 60 characters." }
  if (await nameTaken(ns.id, name)) return { error: `${ns.kind === "user" ? "You" : ns.name} already ${ns.kind === "user" ? "have" : "has"} a connection called “${name}”.` }
  const [c] = await db
    .insert(registryGitConnections)
    .values({
      namespaceId: ns.id,
      provider: v.provider,
      name,
      username: v.provider === "git" || v.provider === "gitlab" || v.provider === "gitea" ? v.username?.trim().slice(0, 100) || null : null,
      account: checked.account,
      host: checked.host,
      secretEnc: sealed(v.provider, secret),
      expiresAt: checked.expiresAt,
      createdBy: actorUserId,
    })
    .returning({ id: registryGitConnections.id })
  await record(actorUserId, ns, { id: c.id, name, provider: v.provider }, "create")
  return { id: c.id, account: checked.account, expiresAt: checked.expiresAt?.toISOString() ?? null }
}

export async function renameConnection(actorUserId: string, id: string, rawName: string): Promise<{ error?: string }> {
  const l = await loadFor(actorUserId, id)
  if ("error" in l) return l
  const name = cleanName(rawName)
  if (!name) return { error: "Give the connection a name of up to 60 characters." }
  if (await nameTaken(l.ns.id, name, id)) return { error: `There is already a connection called “${name}”.` }
  await db.update(registryGitConnections).set({ name }).where(eq(registryGitConnections.id, id))
  await record(actorUserId, l.ns, { id, name, provider: l.c.provider }, "rename", { was: l.c.name })
  return {}
}

// Every source using it picks the new secret up at once.
export async function replaceSecret(actorUserId: string, id: string, rawSecret: string): Promise<{ account?: string | null; expiresAt?: string | null; error?: string }> {
  const l = await loadFor(actorUserId, id)
  if ("error" in l) return l
  const secret = String(rawSecret ?? "").trim()
  if (!secret || secret.length > 16_000) return { error: l.c.provider === "ssh" ? "Paste the private key." : "Enter the token." }
  const checked = await validate({ provider: l.c.provider, host: l.c.host ?? undefined, secret })
  if (checked.error) return { error: checked.error }
  if (l.c.provider === "github" && l.c.account && checked.account && l.c.account.toLowerCase() !== checked.account.toLowerCase())
    return { error: `That token belongs to ${checked.account}, not ${l.c.account}. Add it as a new connection instead.` }
  await db
    .update(registryGitConnections)
    .set({ secretEnc: sealed(l.c.provider, secret), account: checked.account ?? l.c.account, expiresAt: checked.expiresAt, warnedAt: null })
    .where(eq(registryGitConnections.id, id))
  await record(actorUserId, l.ns, { id, name: l.c.name, provider: l.c.provider }, "replace")
  return { account: checked.account ?? l.c.account, expiresAt: checked.expiresAt?.toISOString() ?? null }
}

// The repositories that used it keep their rules but lose their credential until someone picks another.
export async function deleteConnection(actorUserId: string, id: string): Promise<{ repos?: UsedBy[]; error?: string }> {
  const l = await loadFor(actorUserId, id)
  if ("error" in l) return l
  const repos = await usage(id)
  await db.update(registryBuildSources).set({ connectionLost: true }).where(eq(registryBuildSources.connectionId, id))
  await db.delete(registryGitConnections).where(eq(registryGitConnections.id, id))
  await record(actorUserId, l.ns, { id, name: l.c.name, provider: l.c.provider }, "delete", { repos: repos.length })
  return { repos }
}

export const secretOf = (c: Row) => decrypt(c.secretEnc) ?? ""

// ---- using -------------------------------------------------------------------------------------------------

export type Cred = { token?: string; username?: string; sshKey?: string }
export type Credential = { cred: Cred | null; lost: boolean }

export const LOST = "The connection for this repository was removed. Pick one in Builds."

// The one place a source's secret is read: its connection's if it has one, else the old per-repo copy.
export async function sourceCredential(s: Pick<Source, "id" | "kind" | "credentialEnc" | "connectionId" | "connectionLost">): Promise<Credential> {
  if (s.connectionId) {
    const [c] = await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, s.connectionId))
    if (!c) return { cred: null, lost: true }
    void touch(c.id)
    const secret = decrypt(c.secretEnc)
    if (!secret) return { cred: null, lost: true }
    if (c.provider === "ssh") return { cred: { sshKey: secret }, lost: false }
    return { cred: { token: secret, ...(c.username && { username: c.username }) }, lost: false }
  }
  if (s.connectionLost) return { cred: null, lost: true }
  if (!s.credentialEnc) return { cred: null, lost: false }
  const plain = decrypt(s.credentialEnc)
  if (!plain) return { cred: null, lost: false }
  if (s.kind === "github") return { cred: { token: plain }, lost: false }
  try {
    return { cred: JSON.parse(plain) as Cred, lost: false }
  } catch {
    return { cred: null, lost: false }
  }
}

// Once an hour at most per connection.
async function touch(id: string) {
  await db
    .update(registryGitConnections)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(registryGitConnections.id, id), or(isNull(registryGitConnections.lastUsedAt), lt(registryGitConnections.lastUsedAt, sql`now() - interval '1 hour'`))))
    .catch(() => {})
}

// ---- jobs ---------------------------------------------------------------------------------------------------

// Every per-repo credential becomes a connection in the repo's namespace; repos that shared a secret share one.
// Runs once (Redis flag) unless forced, and again harmlessly: sources already converted are skipped.
export async function backfillConnections(o: { force?: boolean } = {}): Promise<{ converted: number; created: number }> {
  const flag = "registry:connections:backfilled"
  if (!o.force && (await redis.get(flag))) return { converted: 0, created: 0 }
  const rows = await db
    .select({ s: registryBuildSources, repo: registryRepos.name, ns: registryNamespaces })
    .from(registryBuildSources)
    .innerJoin(registryRepos, eq(registryRepos.id, registryBuildSources.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(isNull(registryBuildSources.connectionId), sql`${registryBuildSources.credentialEnc} is not null`))
  const made = new Map<string, string>()
  let converted = 0
  for (const r of rows) {
    if (r.s.kind === "upload") continue
    const plain = decrypt(r.s.credentialEnc!)
    const legacy = plain ? splitLegacy(r.s.kind, plain) : null
    if (!legacy) continue
    const key = backfillKey(r.ns.id, legacy.provider, legacy.secret)
    let id = made.get(key)
    if (!id) {
      const from = `${r.ns.name}/${r.repo}`
      let name = `${LEGACY_NAME[legacy.provider]} (from ${from})`
      for (let n = 2; await nameTaken(r.ns.id, name); n++) name = `${LEGACY_NAME[legacy.provider]} (from ${from}) ${n}`
      const [c] = await db
        .insert(registryGitConnections)
        .values({
          namespaceId: r.ns.id,
          provider: legacy.provider,
          name,
          username: legacy.username,
          host: legacy.provider === "github" ? "github.com" : null,
          secretEnc: sealed(legacy.provider, legacy.secret),
          createdBy: (await namespaceOwners(r.ns.id))[0] ?? "system",
        })
        .returning({ id: registryGitConnections.id })
      id = c.id
      made.set(key, id)
    }
    await db.update(registryBuildSources).set({ connectionId: id, credentialEnc: null }).where(eq(registryBuildSources.id, r.s.id))
    converted++
  }
  await redis.set(flag, "1")
  return { converted, created: made.size }
}

// Daily: one bell to the owners per connection, once, when its token has a week or less left (or ran out).
export async function warnExpiring(): Promise<number> {
  const due = await db
    .select()
    .from(registryGitConnections)
    .where(and(isNull(registryGitConnections.warnedAt), sql`${registryGitConnections.expiresAt} <= now() + ${`${WARN_DAYS} days`}::interval`))
    .limit(500)
  for (const c of due) {
    const [claimed] = await db.update(registryGitConnections).set({ warnedAt: new Date() }).where(and(eq(registryGitConnections.id, c.id), isNull(registryGitConnections.warnedAt))).returning({ id: registryGitConnections.id })
    if (!claimed) continue
    const days = Math.max(daysLeft(c.expiresAt) ?? 0, 0)
    for (const uid of await namespaceOwners(c.namespaceId)) await notify(uid, "registry_connection", { data: { name: c.name, days: String(days), href: "/registry?tab=access" } })
  }
  return due.length
}
