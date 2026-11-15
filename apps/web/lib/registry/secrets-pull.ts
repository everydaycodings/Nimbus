// Secrets integration: the "registry-pull" dynamic secret type (short-lived pull tokens, kept as
// leases by lib/secrets/dynamic.ts) and "Save to Secrets" for a token made in the Registry.
//
// A registry-pull connection is a secret_db_connections row with engine "registry": no host or
// admin login; create_sql holds the config JSON {"repos": "all" | [repoId…]}, default_ttl is the
// lease length. A lease is a registry_tokens row named "Secrets lease <leaseId>", owned by the
// connection's creator, ending with the lease; revoking deletes it.
import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { registryNamespaces, registryRepos, registryTokenRepos, registryTokens, secretEnvs } from "@/lib/db/schema"
import { auditScope } from "@/lib/secrets/audit-ctx"
import { KEY_RE } from "@/lib/secrets/consts"
import { kmsConfigured } from "@/lib/secrets/kms"
import { names } from "@/lib/secrets/format"
import { SecretsError, applyOps, envSlugAndFolder, policy, projectCtx } from "@/lib/secrets/service"
import { unlockState } from "@/lib/secrets/unlock"

import { roleIn } from "./access.ts"
import { endpoint, newToken } from "./rules.ts"

export const PULL_TYPE = "registry-pull"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const leaseName = (leaseId: string) => `Secrets lease ${leaseId}`

export type PullConfig = { repos: "all" | string[] }

// The config text stored in create_sql; anything unreadable counts as "no repos" (nothing is minted).
export function parseConfig(raw: string): PullConfig {
  try {
    const c = JSON.parse(raw) as { repos?: unknown }
    if (c.repos === "all") return { repos: "all" }
    if (Array.isArray(c.repos)) return { repos: c.repos.filter((x): x is string => typeof x === "string" && UUID.test(x)) }
  } catch {}
  return { repos: [] }
}

// What the form sends: "all" or repo ids. Returns the text to store, or an error for the field.
export function configText(repos: unknown): { text: string } | { error: string } {
  if (repos === "all") return { text: JSON.stringify({ repos: "all" }) }
  const ids = Array.isArray(repos) ? [...new Set(repos.filter((x): x is string => typeof x === "string" && UUID.test(x)))] : []
  return ids.length ? { text: JSON.stringify({ repos: ids }) } : { error: "Pick at least one repository, or choose all repositories." }
}

export const registryHost = () => endpoint()?.replace(/^https?:\/\//, "") ?? null

// A pull token for one lease. The repos must be ones the owner can read right now.
export async function mintPullToken(o: { leaseId: string; userId: string; repos: PullConfig["repos"]; expiresAt: Date }) {
  const host = registryHost()
  if (!host) throw new SecretsError(503, "The container registry isn't turned on on this server.")
  const [ns] = await db.select().from(registryNamespaces).where(and(eq(registryNamespaces.kind, "user"), eq(registryNamespaces.refId, o.userId)))
  if (!ns) throw new SecretsError(409, "The connection's creator hasn't claimed a registry name yet.")
  let ids: string[] = []
  if (o.repos !== "all") {
    const rows = o.repos.length
      ? await db.select({ id: registryRepos.id, ns: registryNamespaces }).from(registryRepos).innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId)).where(and(inArray(registryRepos.id, o.repos), isNull(registryRepos.deletedAt)))
      : []
    for (const r of rows) if (await roleIn(o.userId, r.ns)) ids.push(r.id)
    if (!ids.length) throw new SecretsError(409, "None of the repositories this connection lists can be read by its creator any more.")
  }
  const { prefix, secret, token } = newToken()
  await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(registryTokens)
      .values({ userId: o.userId, name: leaseName(o.leaseId), prefix, secretEnc: encrypt(secret), access: "pull", allRepos: o.repos === "all", expiresAt: o.expiresAt })
      .returning({ id: registryTokens.id })
    if (ids.length) await tx.insert(registryTokenRepos).values(ids.map((repoId) => ({ tokenId: k.id, repoId })))
  })
  return { username: ns.name, password: token, registry: host }
}

export const extendPullToken = (leaseId: string, expiresAt: Date) =>
  db.update(registryTokens).set({ expiresAt }).where(eq(registryTokens.name, leaseName(leaseId)))

// Idempotent.
export const revokePullToken = (leaseId: string) => db.delete(registryTokens).where(eq(registryTokens.name, leaseName(leaseId)))

// "Save to Secrets project": writes a token as a new secret (key `name`) in one environment of a project the
// member can write to, through the same checks as the Secrets table (role, environment access, protected
// environments become a change request). Secrets must be unlocked in this session (the web unlock screen);
// when it isn't, `locked` is true and the page should send the member there. A key that exists is an error, never overwritten.
export async function saveTokenToSecret(
  userId: string,
  o: { token: string; name: string; projectId: string; envId: string; folder?: string }
): Promise<{ error?: string; locked?: boolean; requested?: boolean }> {
  try {
    if (!(await policy()).enabled) return { error: "An admin turned Secrets off on this server." }
    if (!kmsConfigured()) return { error: "Secrets isn't set up on this server." }
    if (!(await unlockState())?.unlocked) return { error: "Unlock Secrets first.", locked: true }
    const key = o.name.trim()
    if (!KEY_RE.test(key)) return { error: "Name the secret with letters, numbers and _ (like REGISTRY_TOKEN)." }
    const c = await projectCtx(userId, o.projectId)
    if (!c) return { error: "That project isn't here, or you can't open it." }
    const [env] = await db.select({ slug: secretEnvs.slug }).from(secretEnvs).where(and(eq(secretEnvs.id, o.envId), eq(secretEnvs.projectId, o.projectId)))
    if (!env) return { error: "That environment isn't here." }
    const at = await envSlugAndFolder(c, env.slug, o.folder?.trim().replace(/^\/+|\/+$/g, "") ?? "")
    const r = await auditScope.run({ projectId: c.projectId }, async () => {
      const r = await applyOps(c, at.envId, at.folderId, [{ key, value: o.token, comment: "Registry token" }], [], "strict", { via: "registry" })
      if (r.created.length) await audit("secrets_write", { detail: `${r.env}: added ${names(r.created)} (registry token)`, env: r.env })
      return r
    })
    return "request" in r && r.request ? { requested: true } : {}
  } catch (e) {
    if (e instanceof SecretsError) return { error: e.fields ? Object.values(e.fields)[0] : e.message }
    throw e
  }
}
