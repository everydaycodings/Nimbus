// What the web pages do with the container registry: names, orgs, repos, tokens.
// The protocol itself lives beside this (dispatch, blobs, manifests).
import "server-only"

import { headers } from "next/headers"
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { ipFrom } from "@/lib/client-ip"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import {
  registryBlobs,
  registryManifestRefs,
  registryManifests,
  registryNamespaces,
  registryOrgMembers,
  registryOrgs,
  registryRepoBlobs,
  registryRepos,
  registryTags,
  registryTokenRepos,
  registryTokens,
} from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { getStream } from "@/lib/s3"
import { isAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { isClash } from "@/lib/uploads"
import { roleIn } from "./access"
import { registryUsage } from "./quota"
import { EXPIRY_DAYS, endpoint, matchPattern, newToken, registryNameError, splitName } from "./rules"

type Result = { error?: string }
type Role = "owner" | "write" | "read"
type Ns = typeof registryNamespaces.$inferSelect

export const MAX_TOKENS = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Why the page can't be used, or "ready". "unset": setup never turned the registry on.
// "unclaimed": the member hasn't picked their registry name yet.
export type RegistryState = "ready" | "unset" | "off" | "disabled" | "unclaimed"

export async function registryState(userId: string): Promise<RegistryState> {
  if (!endpoint()) return "unset"
  const [[row], s, ns] = await Promise.all([
    db.select({ off: user.registryDisabled }).from(user).where(eq(user.id, userId)),
    getSettings(),
    myNamespace(userId),
  ])
  return !s.registry ? "off" : row?.off ? "disabled" : ns ? "ready" : "unclaimed"
}

export async function myNamespace(userId: string): Promise<Ns | null> {
  const [ns] = await db
    .select()
    .from(registryNamespaces)
    .where(and(eq(registryNamespaces.kind, "user"), eq(registryNamespaces.refId, userId)))
  return ns ?? null
}

async function nameTaken(name: string) {
  const [t] = await db
    .select({ id: registryNamespaces.id })
    .from(registryNamespaces)
    .where(sql`lower(${registryNamespaces.name}) = ${name.toLowerCase()}`)
  return Boolean(t)
}

// A registry name comes from the same pool for members and orgs.
export async function claimName(userId: string, rawName: string): Promise<Result & { name?: string }> {
  const name = rawName.trim().toLowerCase()
  const bad = registryNameError(name)
  if (bad) return { error: bad }
  if (await myNamespace(userId)) return { error: "You already have a registry name." }
  if (await nameTaken(name)) return { error: "That name is taken. Try another." }
  try {
    await db.insert(registryNamespaces).values({ name, kind: "user", refId: userId })
  } catch (e) {
    if (isClash(e)) return { error: "That name is taken. Try another." }
    throw e
  }
  await audit("registry_name_claim", { detail: name })
  return { name }
}

// ---- Orgs ----------------------------------------------------------------

export type OrgRow = { id: string; name: string; displayName: string; role: Role; members: number; repos: number }
export type OrgMember = { userId: string; name: string; email: string; role: Role }

export async function listOrgs(userId: string): Promise<OrgRow[]> {
  const rows = await db
    .select({
      id: registryOrgs.id,
      displayName: registryOrgs.displayName,
      role: registryOrgMembers.role,
      name: registryNamespaces.name,
      nsId: registryNamespaces.id,
    })
    .from(registryOrgMembers)
    .innerJoin(registryOrgs, eq(registryOrgs.id, registryOrgMembers.orgId))
    .innerJoin(
      registryNamespaces,
      and(eq(registryNamespaces.kind, "org"), eq(registryNamespaces.refId, sql`${registryOrgs.id}::text`))
    )
    .where(eq(registryOrgMembers.userId, userId))
    .orderBy(asc(registryNamespaces.name))
  return Promise.all(
    rows.map(async (r) => {
      const [[m], [p]] = await Promise.all([
        db.select({ n: count() }).from(registryOrgMembers).where(eq(registryOrgMembers.orgId, r.id)),
        db
          .select({ n: count() })
          .from(registryRepos)
          .where(and(eq(registryRepos.namespaceId, r.nsId), isNull(registryRepos.deletedAt))),
      ])
      return { id: r.id, name: r.name, displayName: r.displayName, role: r.role, members: m.n, repos: p.n }
    })
  )
}

export async function orgMembers(userId: string, orgId: string): Promise<OrgMember[]> {
  if (!UUID.test(orgId)) return []
  const [mine] = await db
    .select({ role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, userId)))
  if (!mine) return []
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .innerJoin(user, eq(user.id, registryOrgMembers.userId))
    .where(eq(registryOrgMembers.orgId, orgId))
    .orderBy(asc(user.name))
  return rows
}

export async function createOrg(userId: string, rawName: string, rawDisplay: string): Promise<Result & { name?: string }> {
  const [[u], s] = await Promise.all([
    db.select({ role: user.role }).from(user).where(eq(user.id, userId)),
    getSettings(),
  ])
  if (s.registryOrgCreate === "admins" && !(u && isAdmin(u.role as Parameters<typeof isAdmin>[0])))
    return { error: "Only admins can create orgs on this server." }
  const name = rawName.trim().toLowerCase()
  const bad = registryNameError(name)
  if (bad) return { error: bad }
  if (await nameTaken(name)) return { error: "That name is taken. Try another." }
  const displayName = rawDisplay.trim().slice(0, 80) || name
  try {
    await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(registryOrgs)
        .values({ displayName, createdBy: userId })
        .returning({ id: registryOrgs.id })
      await tx.insert(registryNamespaces).values({ name, kind: "org", refId: org.id })
      await tx.insert(registryOrgMembers).values({ orgId: org.id, userId, role: "owner" })
    })
  } catch (e) {
    if (isClash(e)) return { error: "That name is taken. Try another." }
    throw e
  }
  await audit("registry_org_create", { detail: name })
  return { name }
}

async function orgOwned(userId: string, orgId: string) {
  if (!UUID.test(orgId)) return null
  const [m] = await db
    .select({ role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, userId)))
  if (m?.role !== "owner") return null
  const [ns] = await db
    .select()
    .from(registryNamespaces)
    .where(and(eq(registryNamespaces.kind, "org"), eq(registryNamespaces.refId, orgId)))
  return ns ?? null
}

const NOT_OWNER = { error: "Only an owner of the org can do that." }

export async function renameOrg(userId: string, orgId: string, rawDisplay: string): Promise<Result> {
  const ns = await orgOwned(userId, orgId)
  if (!ns) return NOT_OWNER
  const displayName = rawDisplay.trim().slice(0, 80)
  if (!displayName) return { error: "Give the org a display name." }
  await db.update(registryOrgs).set({ displayName }).where(eq(registryOrgs.id, orgId))
  await audit("registry_org_rename", { detail: `${ns.name}: ${displayName}` })
  return {}
}

// Only an empty org (no repos, trash included) can go.
export async function deleteOrg(userId: string, orgId: string): Promise<Result> {
  const ns = await orgOwned(userId, orgId)
  if (!ns) return NOT_OWNER
  const [r] = await db.select({ n: count() }).from(registryRepos).where(eq(registryRepos.namespaceId, ns.id))
  if (r.n) return { error: "Delete or move the org's repositories first. An org must be empty to be deleted." }
  await db.transaction(async (tx) => {
    await tx.delete(registryNamespaces).where(eq(registryNamespaces.id, ns.id))
    await tx.delete(registryOrgs).where(eq(registryOrgs.id, orgId))
  })
  await audit("registry_org_delete", { detail: ns.name })
  return {}
}

const ROLES: Role[] = ["owner", "write", "read"]

export async function addOrgMember(userId: string, orgId: string, email: string, role: string): Promise<Result> {
  const ns = await orgOwned(userId, orgId)
  if (!ns) return NOT_OWNER
  if (!ROLES.includes(role as Role)) return { error: "Pick a role." }
  const [target] = await db
    .select({ id: user.id, status: user.status, off: user.registryDisabled })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
  if (!target || target.status !== "active") return { error: "No member of this Nimbus has that email." }
  if (target.off) return { error: "An admin turned the registry off for that member." }
  const [made] = await db
    .insert(registryOrgMembers)
    .values({ orgId, userId: target.id, role: role as Role })
    .onConflictDoNothing()
    .returning({ id: registryOrgMembers.userId })
  if (!made) return { error: "They're already in this org." }
  await audit("registry_org_member_add", { targetId: target.id, detail: `${ns.name} as ${role}` })
  return {}
}

async function owners(orgId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.role, "owner")))
  return r.n
}

export async function setOrgRole(userId: string, orgId: string, targetId: string, role: string): Promise<Result> {
  const ns = await orgOwned(userId, orgId)
  if (!ns) return NOT_OWNER
  if (!ROLES.includes(role as Role)) return { error: "Pick a role." }
  const [t] = await db
    .select({ role: registryOrgMembers.role })
    .from(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, targetId)))
  if (!t) return {}
  if (t.role === "owner" && role !== "owner" && (await owners(orgId)) < 2)
    return { error: "An org needs at least one owner." }
  await db
    .update(registryOrgMembers)
    .set({ role: role as Role })
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, targetId)))
  await audit("registry_org_member_role", { targetId, detail: `${ns.name}: ${role}` })
  return {}
}

// Owners remove anyone; anyone can leave (unless they're the last owner).
export async function removeOrgMember(userId: string, orgId: string, targetId: string): Promise<Result> {
  if (!UUID.test(orgId)) return {}
  const [[me], [t]] = await Promise.all(
    [userId, targetId].map((id) =>
      db
        .select({ role: registryOrgMembers.role })
        .from(registryOrgMembers)
        .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, id)))
    )
  )
  if (!me || !t) return {}
  if (userId !== targetId && me.role !== "owner") return NOT_OWNER
  if (t.role === "owner" && (await owners(orgId)) < 2) return { error: "An org needs at least one owner." }
  await db
    .delete(registryOrgMembers)
    .where(and(eq(registryOrgMembers.orgId, orgId), eq(registryOrgMembers.userId, targetId)))
  // Their scoped tokens lose the org's repos with the membership check, nothing else to clean.
  await audit("registry_org_member_remove", { targetId, detail: orgId })
  return {}
}

// ---- Repos ---------------------------------------------------------------

export type RepoRow = {
  id: string
  fullName: string
  namespace: string
  name: string
  isPublic: boolean
  role: Role
  tags: number
  bytes: number
  pushedAt: string | null
}

// Everything the member can pull through their own namespace and orgs.
export async function listRepos(userId: string): Promise<RepoRow[]> {
  const rows = await db.execute<{
    id: string
    ns: string
    name: string
    is_public: boolean
    role: Role
    tags: string
    bytes: string
    pushed_at: string | null
  }>(sql`
    select r.id, n.name as ns, r.name, r.is_public,
      case when n.kind = 'user' then 'owner' else m.role end as role,
      (select count(*) from registry_tags t where t.repo_id = r.id and t.deleted_at is null)::text as tags,
      (select coalesce(sum(b.size), 0) from registry_repo_blobs rb
        join registry_blobs b on b.digest = rb.digest where rb.repo_id = r.id)::text as bytes,
      (select max(t.pushed_at) from registry_tags t where t.repo_id = r.id and t.deleted_at is null) as pushed_at
    from registry_repos r
    join registry_namespaces n on n.id = r.namespace_id
    left join registry_org_members m on n.kind = 'org' and m.org_id::text = n.ref_id and m.user_id = ${userId}
    where r.deleted_at is null
      and ((n.kind = 'user' and n.ref_id = ${userId}) or m.user_id is not null)
    order by n.name, r.name`)
  return rows.map((r) => ({
    id: r.id,
    fullName: `${r.ns}/${r.name}`,
    namespace: r.ns,
    name: r.name,
    isPublic: r.is_public,
    role: r.role,
    tags: Number(r.tags),
    bytes: Number(r.bytes),
    pushedAt: r.pushed_at ? new Date(r.pushed_at).toISOString() : null,
  }))
}

export type TagRow = {
  name: string
  digest: string
  mediaType: string
  bytes: number
  platforms: string[]
  pushedBy: string | null
  pushedAt: string
  lastPulledAt: string | null
  immutable: boolean
}

export type RepoDetail = {
  id: string
  fullName: string
  isPublic: boolean
  immutablePattern: string | null
  // Writers can change settings and delete.
  canWrite: boolean
  bytes: number
  tags: TagRow[]
  publicAllowed: boolean
}

// A repo the member can reach (their namespace or an org), with their role.
async function reach(userId: string, fullName: string) {
  const p = splitName(fullName)
  if (!p) return null
  const [row] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(
      and(
        sql`lower(${registryNamespaces.name}) = ${p.namespace.toLowerCase()}`,
        eq(registryRepos.name, p.repo),
        isNull(registryRepos.deletedAt)
      )
    )
  if (!row) return null
  const role = await roleIn(userId, row.ns)
  return role ? { ...row, role } : null
}

// Bytes of one manifest: its config and layers, plus those of every child manifest.
function manifestBytes(
  id: string,
  refs: Map<string, { kind: string; digest: string }[]>,
  blob: Map<string, number>,
  byDigest: Map<string, string>
) {
  const seen = new Set<string>()
  let total = 0
  const walk = (mid: string) => {
    for (const r of refs.get(mid) ?? []) {
      if (r.kind === "blob") {
        if (!seen.has(r.digest)) {
          seen.add(r.digest)
          total += blob.get(r.digest) ?? 0
        }
      } else {
        const child = byDigest.get(r.digest)
        if (child) walk(child)
      }
    }
  }
  walk(id)
  return total
}

export async function repoDetail(userId: string, fullName: string): Promise<RepoDetail | null> {
  const r = await reach(userId, fullName)
  if (!r) return null
  const [tags, manifests, s] = await Promise.all([
    db
      .select({ t: registryTags, by: user.name })
      .from(registryTags)
      .leftJoin(user, eq(user.id, registryTags.pushedBy))
      .where(and(eq(registryTags.repoId, r.repo.id), isNull(registryTags.deletedAt)))
      .orderBy(desc(registryTags.pushedAt)),
    db
      .select({
        id: registryManifests.id,
        digest: registryManifests.digest,
        mediaType: registryManifests.mediaType,
        platforms: registryManifests.platforms,
      })
      .from(registryManifests)
      .where(and(eq(registryManifests.repoId, r.repo.id), isNull(registryManifests.deletedAt))),
    getSettings(),
  ])
  const ids = manifests.map((m) => m.id)
  const refRows = ids.length
    ? await db
        .select()
        .from(registryManifestRefs)
        .where(inArray(registryManifestRefs.manifestId, ids))
    : []
  const blobRows = await db
    .select({ digest: registryBlobs.digest, size: registryBlobs.size })
    .from(registryRepoBlobs)
    .innerJoin(registryBlobs, eq(registryBlobs.digest, registryRepoBlobs.digest))
    .where(eq(registryRepoBlobs.repoId, r.repo.id))
  const refs = new Map<string, { kind: string; digest: string }[]>()
  for (const x of refRows) refs.set(x.manifestId, [...(refs.get(x.manifestId) ?? []), x])
  const blob = new Map(blobRows.map((b) => [b.digest, b.size]))
  const byDigest = new Map(manifests.map((m) => [m.digest, m.id]))
  const mf = new Map(manifests.map((m) => [m.digest, m]))
  const pat = r.repo.immutablePattern
  return {
    id: r.repo.id,
    fullName,
    isPublic: r.repo.isPublic,
    immutablePattern: pat,
    canWrite: r.role !== "read",
    bytes: blobRows.reduce((a, b) => a + b.size, 0),
    publicAllowed: s.registryPublic,
    tags: tags.map(({ t, by }) => {
      const m = mf.get(t.digest)
      return {
        name: t.name,
        digest: t.digest,
        mediaType: m?.mediaType ?? "",
        bytes: m ? manifestBytes(m.id, refs, blob, byDigest) : 0,
        platforms: m?.platforms ?? [],
        pushedBy: by,
        pushedAt: t.pushedAt.toISOString(),
        lastPulledAt: t.lastPulledAt?.toISOString() ?? null,
        immutable: Boolean(pat && matchPattern(pat, t.name)),
      }
    }),
  }
}

export type Layer = { digest: string; size: number; mediaType: string }
export type ImageInfo = {
  platform: string | null
  digest: string
  configDigest: string | null
  layers: Layer[]
  created: string | null
  env: string[]
  entrypoint: string[] | null
  cmd: string[] | null
  labels: Record<string, string>
  workingDir: string | null
  user: string | null
  ports: string[]
  history: string[]
  // The manifest or its config isn't stored here.
  missing?: boolean
}
export type TagDetail = { tag: string; digest: string; mediaType: string; size: number; images: ImageInfo[] }

type Desc = { digest?: string; size?: number; mediaType?: string; platform?: { os?: string; architecture?: string; variant?: string } }

async function readConfig(digest: string) {
  const [b] = await db.select({ key: registryBlobs.key, size: registryBlobs.size }).from(registryBlobs).where(eq(registryBlobs.digest, digest))
  if (!b || b.size > 1_000_000) return null
  try {
    const text = await new Response(await getStream(b.key)).text()
    return JSON.parse(text) as {
      created?: string
      architecture?: string
      os?: string
      config?: {
        Env?: string[]
        Entrypoint?: string[] | null
        Cmd?: string[] | null
        Labels?: Record<string, string> | null
        WorkingDir?: string
        User?: string
        ExposedPorts?: Record<string, unknown> | null
      }
      history?: { created_by?: string; empty_layer?: boolean }[]
    }
  } catch {
    return null
  }
}

async function imageInfo(repoId: string, digest: string, platform: string | null): Promise<ImageInfo> {
  const base: ImageInfo = {
    platform, digest, configDigest: null, layers: [], created: null, env: [], entrypoint: null, cmd: null,
    labels: {}, workingDir: null, user: null, ports: [], history: [], missing: true,
  }
  const [m] = await db
    .select({ bytes: registryManifests.bytes })
    .from(registryManifests)
    .where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest)))
  if (!m) return base
  let j: { config?: Desc; layers?: Desc[] }
  try {
    j = JSON.parse(Buffer.from(m.bytes).toString("utf8"))
  } catch {
    return base
  }
  const layers = (j.layers ?? []).map((l) => ({ digest: l.digest ?? "", size: l.size ?? 0, mediaType: l.mediaType ?? "" }))
  const cfg = j.config?.digest ? await readConfig(j.config.digest) : null
  return {
    ...base,
    missing: false,
    configDigest: j.config?.digest ?? null,
    layers,
    platform: platform ?? (cfg?.os ? `${cfg.os}/${cfg.architecture ?? "?"}` : null),
    created: cfg?.created ?? null,
    env: cfg?.config?.Env ?? [],
    entrypoint: cfg?.config?.Entrypoint ?? null,
    cmd: cfg?.config?.Cmd ?? null,
    labels: cfg?.config?.Labels ?? {},
    workingDir: cfg?.config?.WorkingDir || null,
    user: cfg?.config?.User || null,
    ports: Object.keys(cfg?.config?.ExposedPorts ?? {}),
    history: (cfg?.history ?? []).filter((h) => !h.empty_layer || h.created_by).map((h) => h.created_by ?? "").filter(Boolean),
  }
}

// One tag's manifest: layers, config and history; an index lists each platform.
export async function tagDetail(userId: string, fullName: string, tag: string): Promise<TagDetail | null> {
  const r = await reach(userId, fullName)
  if (!r) return null
  const [t] = await db
    .select()
    .from(registryTags)
    .where(and(eq(registryTags.repoId, r.repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
  if (!t) return null
  const [m] = await db
    .select()
    .from(registryManifests)
    .where(and(eq(registryManifests.repoId, r.repo.id), eq(registryManifests.digest, t.digest)))
  if (!m) return null
  let j: { manifests?: Desc[] } = {}
  try {
    j = JSON.parse(Buffer.from(m.bytes).toString("utf8"))
  } catch {}
  const kids = (j.manifests ?? []).filter((c) => c.digest)
  const images = kids.length
    ? await Promise.all(
        kids.map((c) =>
          imageInfo(
            r.repo.id,
            c.digest!,
            c.platform?.os ? `${c.platform.os}/${c.platform.architecture ?? "?"}${c.platform.variant ? `/${c.platform.variant}` : ""}` : "attestation"
          )
        )
      )
    : [await imageInfo(r.repo.id, m.digest, null)]
  return { tag, digest: m.digest, mediaType: m.mediaType, size: m.size, images }
}

async function writable(userId: string, fullName: string) {
  const r = await reach(userId, fullName)
  return r && r.role !== "read" ? r : null
}

const NO_WRITE = { error: "You can only read this repository." }

export async function setRepoPublic(userId: string, fullName: string, isPublic: boolean): Promise<Result> {
  const r = await writable(userId, fullName)
  if (!r) return NO_WRITE
  if (isPublic && !(await getSettings()).registryPublic)
    return { error: "An admin turned off public repositories on this server." }
  await db.update(registryRepos).set({ isPublic }).where(eq(registryRepos.id, r.repo.id))
  await audit("registry_repo_visibility", { detail: `${fullName}: ${isPublic ? "public" : "private"}` })
  return {}
}

export async function setImmutable(userId: string, fullName: string, raw: string): Promise<Result> {
  const r = await writable(userId, fullName)
  if (!r) return NO_WRITE
  const pattern = raw.trim().slice(0, 200)
  if (pattern.startsWith("re:"))
    try {
      new RegExp(pattern.slice(3))
    } catch {
      return { error: "That regular expression doesn't compile." }
    }
  await db
    .update(registryRepos)
    .set({ immutablePattern: pattern || null })
    .where(eq(registryRepos.id, r.repo.id))
  await audit("registry_repo_immutable", { detail: `${fullName}: ${pattern || "none"}` })
  return {}
}

// Soft delete; the trash page comes later, until then it's out of sight and the protocol 404s.
export async function deleteRepo(userId: string, fullName: string): Promise<Result> {
  const r = await writable(userId, fullName)
  if (!r) return NO_WRITE
  await db.update(registryRepos).set({ deletedAt: new Date() }).where(eq(registryRepos.id, r.repo.id))
  await audit("registry_repo_delete", { detail: fullName })
  return {}
}

export async function deleteTag(userId: string, fullName: string, tag: string): Promise<Result> {
  const r = await writable(userId, fullName)
  if (!r) return NO_WRITE
  if (r.repo.immutablePattern && matchPattern(r.repo.immutablePattern, tag))
    return { error: "That tag is immutable. Change the pattern in Settings first." }
  await db
    .update(registryTags)
    .set({ deletedAt: new Date() })
    .where(and(eq(registryTags.repoId, r.repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
  await audit("registry_tag_delete", { detail: `${fullName}:${tag}` })
  return {}
}

// ---- Tokens --------------------------------------------------------------

export type TokenRow = {
  id: string
  name: string
  prefix: string
  access: "pull" | "push"
  allRepos: boolean
  repos: string[]
  expiresAt: string | null
  expired: boolean
  createdAt: string
  lastUsedAt: string | null
  lastIp: string | null
  member?: string
  memberId?: string
}

// `userId` null: everyone's tokens, for the admin list.
export async function listTokens(userId: string | null): Promise<TokenRow[]> {
  const rows = await db
    .select({ k: registryTokens, member: user.name, email: user.email })
    .from(registryTokens)
    .innerJoin(user, eq(user.id, registryTokens.userId))
    .where(userId ? eq(registryTokens.userId, userId) : undefined)
    .orderBy(desc(registryTokens.createdAt))
  const scoped = rows.filter((r) => !r.k.allRepos).map((r) => r.k.id)
  const picked = scoped.length
    ? await db
        .select({ tokenId: registryTokenRepos.tokenId, repo: registryRepos.name, ns: registryNamespaces.name })
        .from(registryTokenRepos)
        .innerJoin(registryRepos, eq(registryRepos.id, registryTokenRepos.repoId))
        .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
        .where(inArray(registryTokenRepos.tokenId, scoped))
        .orderBy(asc(registryNamespaces.name), asc(registryRepos.name))
    : []
  const now = Date.now()
  return rows.map(({ k, member, email }) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    access: k.access,
    allRepos: k.allRepos,
    repos: picked.filter((p) => p.tokenId === k.id).map((p) => `${p.ns}/${p.repo}`),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    expired: Boolean(k.expiresAt && k.expiresAt.getTime() <= now),
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    lastIp: k.lastIp,
    member: member || email,
    memberId: k.userId,
  }))
}

export type NewToken = {
  name: string
  access: string
  allRepos: boolean
  repoIds: string[]
  // "never", 30, 90 or 365 days.
  expiry: string
}

function expiryDate(raw: string): Date | null | undefined {
  if (raw === "never") return null
  return EXPIRY_DAYS.some((d) => String(d) === raw) ? new Date(Date.now() + Number(raw) * 86_400_000) : undefined
}

export async function createToken(userId: string, o: NewToken): Promise<Result & { token?: string; prefix?: string }> {
  const name = String(o.name ?? "").trim().slice(0, 60)
  if (!name) return { error: "Name the token, like “CI” or “Laptop”." }
  if (o.access !== "pull" && o.access !== "push") return { error: "Pick an access level." }
  const expiresAt = expiryDate(String(o.expiry))
  if (expiresAt === undefined) return { error: "Pick when it expires." }
  const ids = [...new Set(o.repoIds ?? [])].filter((i) => UUID.test(i))
  if (!o.allRepos) {
    if (!ids.length) return { error: "Pick at least one repository, or choose all repositories." }
    const mine = new Set((await listRepos(userId)).map((r) => r.id))
    if (ids.some((i) => !mine.has(i))) return { error: "One of those repositories is gone. Refresh and try again." }
  }
  const [{ n }] = await db.select({ n: count() }).from(registryTokens).where(eq(registryTokens.userId, userId))
  if (n >= MAX_TOKENS) return { error: `You have ${MAX_TOKENS} tokens. Revoke one first.` }
  const { prefix, secret, token } = newToken()
  await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(registryTokens)
      .values({
        userId,
        name,
        prefix,
        secretEnc: encrypt(secret),
        access: o.access as "pull" | "push",
        allRepos: o.allRepos,
        expiresAt,
      })
      .returning({ id: registryTokens.id })
    if (!o.allRepos) await tx.insert(registryTokenRepos).values(ids.map((repoId) => ({ tokenId: k.id, repoId })))
  })
  await audit("registry_token_create", { detail: `${name} (${prefix})` })
  await notify(userId, "registry_token", { data: { name, ip: ipFrom(await headers()) || "" } })
  return { token, prefix }
}

// `userId` set: only that member's token; null: any member's (admins).
export async function revokeToken(userId: string | null, id: string, byAdmin = false): Promise<Result> {
  if (!UUID.test(id)) return {}
  const gone = await db
    .delete(registryTokens)
    .where(and(eq(registryTokens.id, id), userId ? eq(registryTokens.userId, userId) : undefined))
    .returning({ name: registryTokens.name, prefix: registryTokens.prefix, owner: registryTokens.userId })
  if (gone[0])
    await audit("registry_token_revoke", {
      targetId: byAdmin ? gone[0].owner : undefined,
      detail: `${gone[0].name} (${gone[0].prefix})`,
    })
  return {}
}

// ---- Admin ---------------------------------------------------------------

export type AdminRepo = { id: string; fullName: string; isPublic: boolean; bytes: number; tags: number }

export async function adminRepos(): Promise<AdminRepo[]> {
  const rows = await db.execute<{ id: string; ns: string; name: string; is_public: boolean; bytes: string; tags: string }>(sql`
    select r.id, n.name as ns, r.name, r.is_public,
      (select coalesce(sum(b.size), 0) from registry_repo_blobs rb
        join registry_blobs b on b.digest = rb.digest where rb.repo_id = r.id)::text as bytes,
      (select count(*) from registry_tags t where t.repo_id = r.id and t.deleted_at is null)::text as tags
    from registry_repos r join registry_namespaces n on n.id = r.namespace_id
    where r.deleted_at is null order by n.name, r.name`)
  return rows.map((r) => ({
    id: r.id,
    fullName: `${r.ns}/${r.name}`,
    isPublic: r.is_public,
    bytes: Number(r.bytes),
    tags: Number(r.tags),
  }))
}

export async function adminDeleteRepo(id: string): Promise<Result> {
  if (!UUID.test(id)) return {}
  const [row] = await db
    .update(registryRepos)
    .set({ deletedAt: new Date() })
    .where(and(eq(registryRepos.id, id), isNull(registryRepos.deletedAt)))
    .returning({ name: registryRepos.name, ns: registryRepos.namespaceId })
  if (row) {
    const [ns] = await db.select({ name: registryNamespaces.name }).from(registryNamespaces).where(eq(registryNamespaces.id, row.ns))
    await audit("registry_repo_delete", { detail: `${ns?.name}/${row.name} (admin)` })
  }
  return {}
}

export type AdminNamespace = { id: string; name: string; kind: "user" | "org"; quotaBytes: number | null; used: number }

export async function adminNamespaces(): Promise<AdminNamespace[]> {
  const rows = await db.select().from(registryNamespaces).orderBy(asc(registryNamespaces.name))
  return Promise.all(
    rows.map(async (n) => ({ id: n.id, name: n.name, kind: n.kind, quotaBytes: n.quotaBytes, used: await registryUsage(n.id) }))
  )
}

// Null clears the override so the namespace follows the default.
export async function setNamespaceQuota(id: string, bytes: number | null): Promise<Result> {
  if (!UUID.test(id)) return {}
  const [n] = await db
    .update(registryNamespaces)
    .set({ quotaBytes: bytes })
    .where(eq(registryNamespaces.id, id))
    .returning({ name: registryNamespaces.name })
  if (n) await audit("registry_quota", { detail: `${n.name}: ${bytes === null ? "default" : bytes}` })
  return {}
}

// Repos the search box should offer: names containing the text, within what the member can reach.
export async function searchRepos(userId: string, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle || (await registryState(userId)) !== "ready") return []
  return (await listRepos(userId))
    .filter((r) => r.fullName.toLowerCase().includes(needle))
    .slice(0, 5)
    .map((r) => ({ fullName: r.fullName, tags: r.tags }))
}
