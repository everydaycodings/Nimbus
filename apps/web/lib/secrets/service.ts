// Secrets: projects, environments, folders and the values in them. Routes under
// /api/v1/secrets are thin wrappers; every function here assumes the caller
// already passed the unlock check and has the project role it needs (guard.ts).
import "server-only"

import { randomUUID } from "node:crypto"

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  secretAccessRequests,
  secretChangeRequests,
  secretComments,
  secretRequiredKeys,
  secretEnvs,
  secretFolders,
  secretMembers,
  secretOverrides,
  secretProjects,
  secretTagLinks,
  secretTags,
  secretVersions,
  secrets,
  settings,
  user,
} from "@/lib/db/schema"
import {
  FOLDER_RE,
  KEY_RE,
  SECRET_TYPES,
  names,
  serialize,
  validateType,
  type Format,
  type Pair,
} from "./format"
import { checkSchema, type SchemaKind } from "./gov-rules"
import { notifyChange } from "./hooks"
import { newProjectKey, openValue, sealValue, unwrapProjectKey } from "./kms"
import { expand, hasRefs, selfId, type Scope } from "./refs"

export type Role = "admin" | "developer" | "viewer"
export type Ctx = {
  userId: string
  projectId: string
  role: Role
  key: Buffer
  // Environment ids this caller can see; null is all (admins, and members given everything).
  envs: string[] | null
  // Environments this caller may write in; null is all. Left out (the worker, tokens)
  // it follows the role. Temporary developer access adds to it (see grants).
  writeEnvs?: string[] | null
  // Who to name on a change request when it isn't the member (a machine token).
  actor?: { id: string | null; name: string }
}

export class SecretsError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message)
  }
}
const bad = (m: string, status = 400, fields?: Record<string, string>) =>
  new SecretsError(status, m, fields)

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Q = typeof db | Tx

const LIMIT_NAME = 80
const clean = (s: unknown, max = LIMIT_NAME) => String(s ?? "").trim().slice(0, max)
const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "env"

export const seal = (c: Ctx, v: string) => sealValue(c.key, c.projectId, v)
export const unseal = (c: Ctx, v: string) => openValue(c.key, c.projectId, v)

export async function policy() {
  const [row] = await db
    .select({
      enabled: settings.secretsEnabled,
      maxProjects: settings.maxSecretProjectsPerMember,
      maxSecrets: settings.maxSecretsPerProject,
      require2fa: settings.secretRequire2fa,
      sharesEnabled: settings.secretSharesEnabled,
      trashDays: settings.secretTrashDays,
    })
    .from(settings)
  return (
    row ?? { enabled: true, maxProjects: null, maxSecrets: null, require2fa: false, sharesEnabled: true, trashDays: null }
  )
}

// ---- Projects ---------------------------------------------------------------

export async function projectCtx(userId: string, projectId: string): Promise<Ctx | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null
  const [row] = await db
    .select({ role: secretMembers.role, wrapped: secretProjects.wrappedKey, envIds: secretMembers.envIds })
    .from(secretMembers)
    .innerJoin(secretProjects, eq(secretProjects.id, secretMembers.projectId))
    .where(and(eq(secretMembers.projectId, projectId), eq(secretMembers.userId, userId)))
  if (!row) return null
  // Approved temporary access that hasn't run out: checked here on every request.
  const grants = await db
    .select({ envId: secretAccessRequests.envId, role: secretAccessRequests.role })
    .from(secretAccessRequests)
    .where(
      and(
        eq(secretAccessRequests.projectId, projectId),
        eq(secretAccessRequests.userId, userId),
        eq(secretAccessRequests.status, "approved"),
        gt(secretAccessRequests.expiresAt, new Date())
      )
    )
  const granted = grants.map((g) => g.envId)
  const dev = grants.filter((g) => g.role === "developer").map((g) => g.envId)
  const base = row.role === "admin" ? null : row.envIds
  return {
    userId,
    projectId,
    role: row.role,
    key: unwrapProjectKey(projectId, row.wrapped),
    envs: base === null ? null : [...new Set([...base, ...granted])],
    writeEnvs:
      row.role === "admin" ? null : row.role === "developer" ? (base === null ? null : [...new Set([...base, ...dev])]) : dev,
  }
}

// The project's id for a slug or an id, among the member's projects.
export async function memberProjectId(userId: string, ref: string) {
  const [row] = await db
    .select({ id: secretProjects.id })
    .from(secretProjects)
    .innerJoin(secretMembers, eq(secretMembers.projectId, secretProjects.id))
    .where(
      and(
        eq(secretMembers.userId, userId),
        /^[0-9a-f-]{36}$/i.test(ref) ? eq(secretProjects.id, ref) : eq(secretProjects.slug, ref)
      )
    )
  return row?.id ?? null
}

// A caller with every right: the worker pushing a .env or the API for a machine token.
export async function systemCtx(projectId: string): Promise<Ctx | null> {
  const [p] = await db.select().from(secretProjects).where(eq(secretProjects.id, projectId))
  if (!p) return null
  return { userId: p.createdBy ?? "", projectId, role: "admin", key: unwrapProjectKey(projectId, p.wrappedKey), envs: null }
}

const allowed = (c: Ctx, envId: string) => !c.envs || c.envs.includes(envId)
export const canWrite = (c: Ctx, envId: string) =>
  c.writeEnvs === undefined ? c.role !== "viewer" : c.writeEnvs === null || c.writeEnvs.includes(envId)
const mustWrite = (c: Ctx, envIds: Iterable<string>) => {
  for (const e of envIds) if (!canWrite(c, e)) throw bad("Your access to that environment is read-only.", 403)
}
const envScope = (c: Ctx) => (c.envs ? inArray(secrets.envId, c.envs.length ? c.envs : [randomUUID()]) : undefined)

export type ProjectCard = {
  id: string
  slug: string
  name: string
  description: string | null
  role: Role
  envs: number
  secrets: number
}

export async function listProjects(userId: string): Promise<ProjectCard[]> {
  const rows = await db.execute<ProjectCard>(sql`
    select p.id, p.slug, p.name, p.description, m.role,
      (select count(*)::int from secret_envs e where e.project_id = p.id) as envs,
      (select count(*)::int from secrets s where s.project_id = p.id and s.deleted_at is null) as secrets
    from secret_projects p join secret_members m on m.project_id = p.id
    where m.user_id = ${userId} order by lower(p.name)`)
  return [...rows]
}

// The cap when this member has reached it, else null.
export async function projectLimitHit(userId: string) {
  const pol = await policy()
  if (pol.maxProjects === null) return null
  const [{ c }] = await db
    .select({ c: count() })
    .from(secretProjects)
    .where(eq(secretProjects.createdBy, userId))
  return c >= pol.maxProjects ? pol.maxProjects : null
}

export async function createProject(userId: string, name: string, description?: string) {
  const n = clean(name)
  if (!n) throw bad("Give the project a name.")
  const pol = await policy()
  if (pol.maxProjects !== null) {
    const [{ c }] = await db
      .select({ c: count() })
      .from(secretProjects)
      .where(eq(secretProjects.createdBy, userId))
    if (c >= pol.maxProjects)
      throw bad(`You can have ${pol.maxProjects} project${pol.maxProjects === 1 ? "" : "s"} here.`, 403)
  }
  const id = randomUUID()
  const { wrapped } = newProjectKey(id)
  const taken = new Set(
    (await db.select({ s: secretProjects.slug }).from(secretProjects)).map((r) => r.s)
  )
  const base = slugify(n).slice(0, 40)
  let slug = base
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
  await db.transaction(async (tx) => {
    await tx.insert(secretProjects).values({
      id,
      name: n,
      slug,
      description: clean(description, 300) || null,
      wrappedKey: wrapped,
      createdBy: userId,
    })
    await tx.insert(secretMembers).values({ projectId: id, userId, role: "admin" })
    await tx.insert(secretEnvs).values(
      ["Development", "Staging", "Production"].map((name, position) => ({
        projectId: id,
        name,
        slug: slugify(name),
        position,
      }))
    )
  })
  return id
}

export async function updateProject(c: Ctx, name: string, description?: string) {
  const n = clean(name)
  if (!n) throw bad("Give the project a name.")
  await db
    .update(secretProjects)
    .set({ name: n, description: clean(description, 300) || null })
    .where(eq(secretProjects.id, c.projectId))
}

export const deleteProject = (c: Ctx) =>
  db.delete(secretProjects).where(eq(secretProjects.id, c.projectId))

export type EnvRow = {
  id: string
  name: string
  slug: string
  position: number
  protected: boolean
  approvalsRequired: number
  approverIds: string[] | null
  adminBypass: boolean
}
export type FolderRow = { id: string; envId: string; parentId: string | null; name: string; path: string }

export async function projectDetail(c: Ctx) {
  const [p] = await db.select().from(secretProjects).where(eq(secretProjects.id, c.projectId))
  const envs = (
    await db
      .select({
        id: secretEnvs.id,
        name: secretEnvs.name,
        slug: secretEnvs.slug,
        position: secretEnvs.position,
        protected: secretEnvs.protected,
        approvalsRequired: secretEnvs.approvalsRequired,
        approverIds: secretEnvs.approverIds,
        adminBypass: secretEnvs.adminBypass,
      })
      .from(secretEnvs)
      .where(eq(secretEnvs.projectId, c.projectId))
      .orderBy(asc(secretEnvs.position), asc(secretEnvs.name))
  ).filter((e) => allowed(c, e.id))
  const folders = await foldersOf(c.projectId, db, envs.map((e) => e.id))
  const [{ trash }] = await db
    .select({ trash: count() })
    .from(secrets)
    .where(
      and(
        eq(secrets.projectId, c.projectId),
        isNotNull(secrets.deletedAt),
        inArray(secrets.envId, envs.length ? envs.map((e) => e.id) : [randomUUID()])
      )
    )
  const envIds = envs.length ? envs.map((e) => e.id) : [randomUUID()]
  const [{ openRequests }] = await db
    .select({ openRequests: count() })
    .from(secretChangeRequests)
    .where(and(eq(secretChangeRequests.projectId, c.projectId), eq(secretChangeRequests.status, "open"), inArray(secretChangeRequests.envId, envIds)))
  const [{ pendingAccess }] =
    c.role === "admin"
      ? await db
          .select({ pendingAccess: count() })
          .from(secretAccessRequests)
          .where(and(eq(secretAccessRequests.projectId, c.projectId), eq(secretAccessRequests.status, "pending")))
      : [{ pendingAccess: 0 }]
  const grants = await db
    .select({ envId: secretAccessRequests.envId, role: secretAccessRequests.role, expiresAt: secretAccessRequests.expiresAt })
    .from(secretAccessRequests)
    .where(
      and(
        eq(secretAccessRequests.projectId, c.projectId),
        eq(secretAccessRequests.userId, c.userId),
        eq(secretAccessRequests.status, "approved"),
        gt(secretAccessRequests.expiresAt, new Date())
      )
    )
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    role: c.role,
    envs,
    folders,
    trash,
    maxSecrets: (await policy()).maxSecrets,
    openRequests,
    pendingAccess,
    writableEnvs: envs.filter((e) => canWrite(c, e.id)).map((e) => e.id),
    grants: grants.map((g) => ({ envId: g.envId, role: g.role, expiresAt: g.expiresAt!.toISOString() })),
    userId: c.userId,
  }
}

// ---- Environments -----------------------------------------------------------

async function env(c: Ctx, envId: string, q: Q = db) {
  const [e] = await q
    .select()
    .from(secretEnvs)
    .where(and(eq(secretEnvs.id, envId), eq(secretEnvs.projectId, c.projectId)))
  if (!e || !allowed(c, e.id)) throw bad("That environment doesn't exist.", 404)
  return e
}

export const requireEnv = (c: Ctx, envId: string) => env(c, envId)

// An environment the caller can change.
async function wenv(c: Ctx, envId: string, q: Q = db) {
  const e = await env(c, envId, q)
  mustWrite(c, [e.id])
  return e
}

export async function addEnv(c: Ctx, name: string) {
  const n = clean(name, 40)
  if (!n) throw bad("Give the environment a name.")
  const have = await db.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId))
  const base = slugify(n)
  let slug = base
  for (let i = 2; have.some((e) => e.slug === slug); i++) slug = `${base}-${i}`
  const position = have.reduce((m, e) => Math.max(m, e.position + 1), 0)
  const [row] = await db
    .insert(secretEnvs)
    .values({ projectId: c.projectId, name: n, slug, position })
    .returning({ id: secretEnvs.id })
  return row.id
}

// The slug stays, so ${env.KEY} references and API paths keep working.
export async function renameEnv(c: Ctx, envId: string, name: string) {
  const n = clean(name, 40)
  if (!n) throw bad("Give the environment a name.")
  await env(c, envId)
  await db.update(secretEnvs).set({ name: n }).where(eq(secretEnvs.id, envId))
}

export async function reorderEnvs(c: Ctx, ids: string[]) {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx
        .update(secretEnvs)
        .set({ position: i })
        .where(and(eq(secretEnvs.id, id), eq(secretEnvs.projectId, c.projectId)))
  })
}

export async function deleteEnv(c: Ctx, envId: string) {
  await env(c, envId)
  const [{ n }] = await db
    .select({ n: count() })
    .from(secretEnvs)
    .where(eq(secretEnvs.projectId, c.projectId))
  if (n <= 1) throw bad("A project needs at least one environment.")
  await db.delete(secretEnvs).where(eq(secretEnvs.id, envId))
}

// ---- Folders ----------------------------------------------------------------

export async function foldersOf(projectId: string, q: Q = db, onlyEnvs?: string[]): Promise<FolderRow[]> {
  const rows = (await q
    .select({
      id: secretFolders.id,
      envId: secretFolders.envId,
      parentId: secretFolders.parentId,
      name: secretFolders.name,
    })
    .from(secretFolders)
    .where(eq(secretFolders.projectId, projectId))
  ).filter((r) => !onlyEnvs || onlyEnvs.includes(r.envId))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const path = (r: (typeof rows)[number]): string =>
    r.parentId && byId.get(r.parentId) ? `${path(byId.get(r.parentId)!)}/${r.name}` : r.name
  return rows.map((r) => ({ ...r, path: path(r) })).sort((a, b) => a.path.localeCompare(b.path))
}

async function folder(c: Ctx, folderId: string | null, envId: string, q: Q = db) {
  if (!folderId) return null
  const [f] = await q
    .select()
    .from(secretFolders)
    .where(and(eq(secretFolders.id, folderId), eq(secretFolders.envId, envId), eq(secretFolders.projectId, c.projectId)))
  if (!f) throw bad("That folder doesn't exist.", 404)
  return f
}

export async function createFolder(c: Ctx, envId: string, parentId: string | null, name: string) {
  const n = clean(name, 40)
  if (!FOLDER_RE.test(n)) throw bad("Folder names use letters, numbers, - and _.")
  await wenv(c, envId)
  await folder(c, parentId, envId)
  const sibs = await db
    .select({ name: secretFolders.name })
    .from(secretFolders)
    .where(
      and(
        eq(secretFolders.envId, envId),
        parentId ? eq(secretFolders.parentId, parentId) : isNull(secretFolders.parentId)
      )
    )
  if (sibs.some((s) => s.name.toLowerCase() === n.toLowerCase()))
    throw bad("A folder with that name is already here.")
  const [row] = await db
    .insert(secretFolders)
    .values({ projectId: c.projectId, envId, parentId, name: n })
    .returning({ id: secretFolders.id })
  return row.id
}

export async function renameFolder(c: Ctx, folderId: string, name: string) {
  const n = clean(name, 40)
  if (!FOLDER_RE.test(n)) throw bad("Folder names use letters, numbers, - and _.")
  const [f] = await db
    .select()
    .from(secretFolders)
    .where(and(eq(secretFolders.id, folderId), eq(secretFolders.projectId, c.projectId)))
  if (!f || !allowed(c, f.envId)) throw bad("That folder doesn't exist.", 404)
  mustWrite(c, [f.envId])
  const sibs = await db
    .select({ id: secretFolders.id, name: secretFolders.name })
    .from(secretFolders)
    .where(
      and(
        eq(secretFolders.envId, f.envId),
        f.parentId ? eq(secretFolders.parentId, f.parentId) : isNull(secretFolders.parentId)
      )
    )
  if (sibs.some((s) => s.id !== f.id && s.name.toLowerCase() === n.toLowerCase()))
    throw bad("A folder with that name is already here.")
  await db.update(secretFolders).set({ name: n }).where(eq(secretFolders.id, folderId))
}

// The folder and everything in it. Its secrets go to the project's trash (they
// come back at the top level of their environment).
export async function deleteFolder(c: Ctx, folderId: string) {
  const all = await foldersOf(c.projectId)
  const f = all.find((x) => x.id === folderId)
  if (!f || !allowed(c, f.envId)) throw bad("That folder doesn't exist.", 404)
  mustWrite(c, [f.envId])
  await refuseProtected(f.envId, "Delete the folder's secrets through a change request first.", c)
  const ids = new Set([folderId])
  for (let grew = true; grew; ) {
    grew = false
    for (const x of all)
      if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
        ids.add(x.id)
        grew = true
      }
  }
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(secrets)
      .set({ deletedAt: new Date(), deletedBy: c.userId })
      .where(and(inArray(secrets.folderId, [...ids]), isNull(secrets.deletedAt)))
      .returning({ id: secrets.id, v: secrets.version, enc: secrets.valueEnc, comment: secrets.comment, type: secrets.type, key: secrets.key, folderId: secrets.folderId })
    if (rows.length)
      await tx.insert(secretVersions).values(
        rows.map((r) => ({
          secretId: r.id,
          key: r.key,
          folderId: r.folderId,
          version: r.v,
          valueEnc: r.enc,
          comment: r.comment,
          type: r.type,
          action: "delete",
          changedBy: c.userId,
        }))
      )
    await tx.delete(secretFolders).where(eq(secretFolders.id, folderId))
  })
  await changed(c, [f.envId], [])
  return f.path
}

// The folder at `path` in an environment, made if needed. Null for the root.
export async function ensurePath(c: Ctx, envId: string, path: string, tx: Q) {
  let parent: string | null = null
  for (const name of path.split("/").filter(Boolean)) {
    const here: string | null = parent
    const [hit] = await tx
      .select({ id: secretFolders.id })
      .from(secretFolders)
      .where(
        and(
          eq(secretFolders.envId, envId),
          eq(secretFolders.name, name),
          here ? eq(secretFolders.parentId, here) : isNull(secretFolders.parentId)
        )
      )
    if (hit) parent = hit.id
    else {
      const made: { id: string }[] = await tx
        .insert(secretFolders)
        .values({ projectId: c.projectId, envId, parentId: here, name })
        .returning({ id: secretFolders.id })
      parent = made[0].id
    }
  }
  return parent
}

// ---- Reading ----------------------------------------------------------------

type Row = typeof secrets.$inferSelect

// Every live secret of the project, decrypted, with a lookup for references.
// Only used server-side to expand references and answer exports.
export async function loadAll(c: Ctx, q: Q = db) {
  const envs = (await q.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId))).filter((e) =>
    allowed(c, e.id)
  )
  const folders = await foldersOf(c.projectId, q, envs.map((e) => e.id))
  const rows = (
    await q
      .select()
      .from(secrets)
      .where(and(eq(secrets.projectId, c.projectId), isNull(secrets.deletedAt)))
  ).filter((r) => allowed(c, r.envId))
  const envSlug = new Map(envs.map((e) => [e.id, e.slug]))
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  const items = rows.map((r) => ({
    row: r,
    scope: { env: envSlug.get(r.envId)!, folder: r.folderId ? (pathOf.get(r.folderId) ?? "") : "" } as Scope,
    value: unseal(c, r.valueEnc),
  }))
  const map = new Map(items.map((i) => [`${i.scope.env}\0${i.scope.folder}\0${i.row.key}`, i.value]))
  const lookup = (e: string, f: string, k: string) => map.get(`${e}\0${f}\0${k}`)
  return { items, lookup, envs, folders }
}

export type SecretRow = {
  id: string
  key: string
  comment: string | null
  type: string | null
  rotationAt: string | null
  version: number
  comments: number
  tags: string[]
  override: boolean
  folderId: string | null
  updatedAt: string
  updatedBy: string | null
}

async function describe(c: Ctx, rows: Row[]): Promise<SecretRow[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const links = await db
    .select({ id: secretTagLinks.secretId, name: secretTags.name })
    .from(secretTagLinks)
    .innerJoin(secretTags, eq(secretTags.id, secretTagLinks.tagId))
    .where(inArray(secretTagLinks.secretId, ids))
  const over = await db
    .select({ id: secretOverrides.secretId })
    .from(secretOverrides)
    .where(and(inArray(secretOverrides.secretId, ids), eq(secretOverrides.userId, c.userId)))
  const people = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(rows.flatMap((r) => (r.updatedBy ? [r.updatedBy] : [])))]))
  const who = new Map(people.map((p) => [p.id, p.name]))
  const overridden = new Set(over.map((o) => o.id))
  const talk = await db
    .select({ id: secretComments.secretId, n: count() })
    .from(secretComments)
    .where(inArray(secretComments.secretId, ids))
    .groupBy(secretComments.secretId)
  const talks = new Map(talk.map((t) => [t.id, t.n]))
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    comment: r.comment,
    type: r.type,
    rotationAt: r.rotationAt?.toISOString().slice(0, 10) ?? null,
    version: r.version,
    comments: talks.get(r.id) ?? 0,
    tags: links.filter((l) => l.id === r.id).map((l) => l.name).sort(),
    override: overridden.has(r.id),
    folderId: r.folderId,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy ? (who.get(r.updatedBy) ?? null) : null,
  }))
}

// Rows without values; values only leave through readValues / exportPairs.
export async function listSecrets(c: Ctx, envId: string, folderId: string | null) {
  await env(c, envId)
  await folder(c, folderId, envId)
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.envId, envId),
        folderId ? eq(secrets.folderId, folderId) : isNull(secrets.folderId),
        isNull(secrets.deletedAt)
      )
    )
    .orderBy(asc(secrets.key))
  return describe(c, rows)
}

// Values for these secrets: the shared value, the caller's personal override (or
// null) and, when either has references, `resolved` with them expanded.
export async function readValues(c: Ctx, ids: string[]) {
  const all = await loadAll(c)
  const want = new Set(ids)
  const over = ids.length
    ? await db
        .select()
        .from(secretOverrides)
        .where(and(inArray(secretOverrides.secretId, ids), eq(secretOverrides.userId, c.userId)))
    : []
  const mine = new Map(over.map((o) => [o.secretId, unseal(c, o.valueEnc)]))
  return all.items
    .filter((i) => want.has(i.row.id))
    .map((i) => {
      const effective = mine.get(i.row.id) ?? i.value
      const r = hasRefs(effective) ? expand(effective, i.scope, all.lookup, selfId(i.scope, i.row.key)) : null
      return {
        id: i.row.id,
        key: i.row.key,
        env: i.scope.env,
        folder: i.scope.folder,
        value: i.value,
        override: mine.get(i.row.id) ?? null,
        resolved: r ? r.value : null,
        problems: r ? r.errors.map((e) => e.message) : [],
      }
    })
}

// Key/value pairs of one folder (or the chosen ids), for export and the CLI.
export async function exportPairs(
  c: Ctx,
  where: { envId: string; folderId: string | null } | { ids: string[] },
  opts: { expand: boolean; own: boolean }
): Promise<Pair[]> {
  const all = await loadAll(c)
  let items = all.items
  if ("ids" in where) items = items.filter((i) => where.ids.includes(i.row.id))
  else {
    await env(c, where.envId)
    items = items.filter(
      (i) => i.row.envId === where.envId && (i.row.folderId ?? null) === where.folderId
    )
  }
  const over = opts.own && items.length
    ? await db
        .select()
        .from(secretOverrides)
        .where(
          and(
            inArray(secretOverrides.secretId, items.map((i) => i.row.id)),
            eq(secretOverrides.userId, c.userId)
          )
        )
    : []
  const mine = new Map(over.map((o) => [o.secretId, unseal(c, o.valueEnc)]))
  return items
    .sort((a, b) => a.row.key.localeCompare(b.row.key))
    .map((i) => {
      const v = mine.get(i.row.id) ?? i.value
      return {
        key: i.row.key,
        value: opts.expand ? expand(v, i.scope, all.lookup, selfId(i.scope, i.row.key)).value : v,
      }
    })
}

export const exportText = (pairs: Pair[], format: Format) => serialize(pairs, format)

// The API's view of one folder: key, value, type, comment. `own` applies the caller's
// personal overrides (user tokens only, and only when expanding).
export async function apiSecrets(c: Ctx, envId: string, folderId: string | null, opts: { expand: boolean; own: boolean }) {
  await env(c, envId)
  const all = await loadAll(c)
  const items = all.items.filter((i) => i.row.envId === envId && (i.row.folderId ?? null) === folderId)
  const over =
    opts.own && opts.expand && items.length
      ? await db
          .select()
          .from(secretOverrides)
          .where(and(inArray(secretOverrides.secretId, items.map((i) => i.row.id)), eq(secretOverrides.userId, c.userId)))
      : []
  const mine = new Map(over.map((o) => [o.secretId, unseal(c, o.valueEnc)]))
  return items
    .sort((a, b) => a.row.key.localeCompare(b.row.key))
    .map((i) => {
      const v = mine.get(i.row.id) ?? i.value
      return {
        key: i.row.key,
        value: opts.expand ? expand(v, i.scope, all.lookup, selfId(i.scope, i.row.key)).value : v,
        type: i.row.type ?? "string",
        comment: i.row.comment ?? "",
      }
    })
}

// ---- Change hooks -----------------------------------------------------------

// Every write ends here: bumps each environment's version (the API's ETag, so
// agents notice) and queues pushes and webhooks. `keys` are names only.
async function bump(envIds: string[]) {
  if (envIds.length)
    await db
      .update(secretEnvs)
      .set({ version: sql`${secretEnvs.version} + 1` })
      .where(inArray(secretEnvs.id, envIds))
}
export async function changed(c: Ctx, envIds: string[], keys: string[], quiet = false) {
  const ids = [...new Set(envIds)]
  await bump(ids)
  if (!quiet) {
    await notifyChange(c.projectId, ids, keys)
    await (await import("./notices")).envChanged(c, ids, keys)
  }
}

// Moves, restores and purges aren't part of a change request, so a protected
// environment refuses them (an admin who may bypass can still do them).
async function refuseProtected(envId: string, hint: string, c?: Ctx) {
  const [e] = await db.select().from(secretEnvs).where(eq(secretEnvs.id, envId))
  if (e?.protected && !(c && e.adminBypass && c.role === "admin"))
    throw bad(`${e.name} is protected. ${hint}`, 409)
}

export async function envVersion(projectId: string, envId: string) {
  const [e] = await db
    .select({ v: secretEnvs.version })
    .from(secretEnvs)
    .where(and(eq(secretEnvs.id, envId), eq(secretEnvs.projectId, projectId)))
  return e?.v ?? 0
}

export async function projectEnvs(projectId: string) {
  return db
    .select({ id: secretEnvs.id, name: secretEnvs.name, slug: secretEnvs.slug, position: secretEnvs.position })
    .from(secretEnvs)
    .where(eq(secretEnvs.projectId, projectId))
    .orderBy(asc(secretEnvs.position), asc(secretEnvs.name))
}

export async function envSlugAndFolder(c: Ctx, envSlug: string, path: string) {
  const [e] = await db
    .select()
    .from(secretEnvs)
    .where(and(eq(secretEnvs.projectId, c.projectId), eq(secretEnvs.slug, envSlug)))
  if (!e || !allowed(c, e.id)) throw bad("That environment doesn't exist.", 404)
  const f = (await foldersOf(c.projectId)).find((x) => x.envId === e.id && x.path === path)
  if (path && !f) throw bad("That folder doesn't exist.", 404)
  return { envId: e.id, folderId: f?.id ?? null }
}

export async function overview(c: Ctx, path: string) {
  const all = await loadAll(c)
  const reqs = await requiredKeys(c.projectId)
  const envs = [...all.envs].sort((a, b) => a.position - b.position)
  const rows = new Map<string, Record<string, { id: string; empty: boolean; invalid?: string }>>()
  for (const i of all.items) {
    if (i.scope.folder !== path) continue
    const cells = rows.get(i.row.key) ?? {}
    const rk = reqs.get(i.row.key)
    const invalid = (rk && checkSchema(rk.kind, rk.pattern, i.value)) || undefined
    cells[i.row.envId] = { id: i.row.id, empty: i.value === "", ...(invalid && { invalid }) }
    rows.set(i.row.key, cells)
  }
  // Required keys show even when no environment has them yet (top level only).
  if (path === "") for (const k of reqs.keys()) if (!rows.has(k)) rows.set(k, {})
  const folders = all.folders.filter((f) => f.path.split("/").slice(0, -1).join("/") === path)
  return {
    envs: envs.map((e) => ({ id: e.id, name: e.name, slug: e.slug })),
    folders: [...new Map(folders.map((f) => [f.name, f.name])).values()],
    rows: [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, cells]) => ({
        key,
        cells,
        required: path === "" && reqs.has(key) ? { kind: reqs.get(key)!.kind, pattern: reqs.get(key)!.pattern } : null,
      })),
  }
}

export async function search(c: Ctx, q: string) {
  const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.projectId, c.projectId),
        isNull(secrets.deletedAt),
        c.envs ? inArray(secrets.envId, c.envs.length ? c.envs : [randomUUID()]) : undefined,
        sql`(${secrets.key} ilike ${term} or ${secrets.comment} ilike ${term} or exists (
          select 1 from secret_tag_links l join secret_tags t on t.id = l.tag_id
          where l.secret_id = ${secrets.id} and t.name ilike ${term}))`
      )
    )
    .orderBy(asc(secrets.key))
    .limit(100)
  const [envs, folders, described] = await Promise.all([
    db.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId)),
    foldersOf(c.projectId),
    describe(c, rows),
  ])
  return described.map((d, i) => ({
    ...d,
    envId: rows[i].envId,
    env: envs.find((e) => e.id === rows[i].envId)?.name ?? "",
    folder: folders.find((f) => f.id === rows[i].folderId)?.path ?? "",
  }))
}

export async function listTags(c: Ctx) {
  const rows = await db
    .select({ name: secretTags.name })
    .from(secretTags)
    .where(eq(secretTags.projectId, c.projectId))
    .orderBy(asc(secretTags.name))
  return rows.map((r) => r.name)
}

// ---- Writing ----------------------------------------------------------------

export type Op = {
  id?: string
  key: string
  value?: string
  comment?: string | null
  type?: string | null
  rotationAt?: string | null
  tags?: string[]
}

async function tagIds(c: Ctx, names: string[], tx: Q) {
  const clean_ = [...new Set(names.map((n) => clean(n, 32)).filter(Boolean))]
  if (!clean_.length) return []
  await tx
    .insert(secretTags)
    .values(clean_.map((name) => ({ projectId: c.projectId, name })))
    .onConflictDoNothing()
  return tx
    .select({ id: secretTags.id, name: secretTags.name })
    .from(secretTags)
    .where(and(eq(secretTags.projectId, c.projectId), inArray(secretTags.name, clean_)))
}

async function version(
  tx: Q,
  c: Ctx,
  r: { id: string; version: number; valueEnc: string; comment: string | null; type: string | null; key: string; folderId: string | null },
  action: string
) {
  await tx.insert(secretVersions).values({
    secretId: r.id,
    key: r.key,
    folderId: r.folderId,
    version: r.version,
    valueEnc: r.valueEnc,
    comment: r.comment,
    type: r.type,
    action,
    changedBy: c.userId,
  })
}

// Thrown inside a dry run's transaction so nothing is kept.
class DryRun extends Error {}

export type ApplyOpts = {
  // Check everything, change nothing.
  dry?: boolean
  // What the history calls these versions (default: create, update, import).
  action?: string
  // A change request being merged: skip the protected check, and the caller's
  // transaction runs it (it calls changed() once that commits).
  direct?: boolean
  tx?: Tx
  // Where the edit came from, for a change request it becomes: save, import, bulk, rollback, api.
  via?: string
}

// Creates and edits in one transaction; nothing is saved if any row is wrong.
// strict: a new row whose key exists is an error (the table). merge: it updates
// that secret (imports). In a protected environment the edit becomes a change
// request instead (`request` in the answer), unless an admin may bypass.
export async function applyOps(
  c: Ctx,
  envId: string,
  folderId: string | null,
  ops: Op[],
  deletes: string[],
  mode: "strict" | "merge" = "strict",
  opts: ApplyOpts = {}
) {
  const e = await wenv(c, envId, opts.tx ?? db)
  await folder(c, folderId, envId, opts.tx ?? db)
  const bypass = e.protected && e.adminBypass && c.role === "admin"
  if (e.protected && !opts.direct && !opts.dry && !bypass) {
    const dry = await applyOps(c, envId, folderId, ops, deletes, mode, { ...opts, dry: true })
    const request = await (await import("./requests")).requestFromOps(c, e, folderId, ops, deletes, opts.via ?? "save", dry)
    return { created: [] as string[], updated: [] as string[], deleted: [] as string[], env: e.name, request }
  }
  const pol = await policy()
  const reqs = await requiredKeys(c.projectId)
  const errors: Record<string, string> = {}
  const summary = { created: [] as string[], updated: [] as string[], deleted: [] as string[] }

  const run = async (tx: Q) => {
    const inFolder = (alias = secrets) =>
      and(
        eq(alias.envId, envId),
        folderId ? eq(alias.folderId, folderId) : isNull(alias.folderId),
        isNull(alias.deletedAt)
      )
    const existing = await tx.select().from(secrets).where(inFolder())
    const byKey = new Map(existing.map((r) => [r.key, r]))
    const byId = new Map(existing.map((r) => [r.id, r]))
    const touched: string[] = []
    const seen = new Set<string>()
    const gone = new Set(deletes)

    // Deletes first, so a key can be reused in the same save.
    for (const id of deletes) {
      const r = byId.get(id)
      if (!r) continue
      await tx
        .update(secrets)
        .set({ deletedAt: new Date(), deletedBy: c.userId })
        .where(eq(secrets.id, id))
      await version(tx, c, r, "delete")
      byKey.delete(r.key)
      summary.deleted.push(r.key)
    }

    let added = 0
    for (const [i, op] of ops.entries()) {
      const at = String(i)
      const key = op.key?.trim()
      if (!key || !KEY_RE.test(key)) {
        errors[at] = "Keys use letters, numbers and _, and can't start with a number."
        continue
      }
      if (seen.has(key)) {
        errors[at] = `${key} is in this save twice.`
        continue
      }
      seen.add(key)
      const type = op.type === undefined ? undefined : op.type || null
      if (type && !(SECRET_TYPES as readonly string[]).includes(type)) {
        errors[at] = "Unknown type."
        continue
      }
      const rot = op.rotationAt === undefined ? undefined : op.rotationAt ? new Date(op.rotationAt) : null
      if (rot && isNaN(+rot)) {
        errors[at] = "That reminder date isn't valid."
        continue
      }
      let target = op.id ? byId.get(op.id) : mode === "merge" ? byKey.get(key) : undefined
      if (op.id && (!target || gone.has(op.id))) {
        errors[at] = "That secret changed or is gone. Reload."
        continue
      }
      const clash = byKey.get(key)
      if (clash && clash.id !== target?.id) {
        errors[at] = `${key} already exists here.`
        continue
      }
      const value = op.value
      const effType = type === undefined ? (target?.type ?? null) : type
      const check = value !== undefined ? value : target ? unseal(c, target.valueEnc) : ""
      const typeError = validateType(effType, check)
      if (typeError) {
        errors[at] = `${key}: ${typeError}`
        continue
      }
      const rk = reqs.get(key)
      const shapeError = rk && checkSchema(rk.kind, rk.pattern, check)
      if (shapeError) {
        errors[at] = `${key}: ${shapeError} (this key's required format)`
        continue
      }
      const comment = op.comment === undefined ? undefined : clean(op.comment, 1000) || null

      if (!target) {
        if (pol.maxSecrets !== null) {
          const [{ n }] = await tx
            .select({ n: count() })
            .from(secrets)
            .where(and(eq(secrets.projectId, c.projectId), isNull(secrets.deletedAt)))
          if (n + added >= pol.maxSecrets) {
            errors[at] = `This project is at its limit of ${pol.maxSecrets} secrets.`
            continue
          }
        }
        added++
        const [row] = await tx
          .insert(secrets)
          .values({
            projectId: c.projectId,
            envId,
            folderId,
            key,
            valueEnc: seal(c, value ?? ""),
            comment: comment ?? null,
            type: effType,
            rotationAt: rot ?? null,
            createdBy: c.userId,
            updatedBy: c.userId,
          })
          .returning()
        await version(tx, c, row, opts.action ?? (mode === "merge" ? "import" : "create"))
        target = row
        byKey.set(key, row)
        summary.created.push(key)
      } else {
        const next = value !== undefined ? seal(c, value) : target.valueEnc
        const changed =
          value !== undefined ||
          key !== target.key ||
          (comment !== undefined && comment !== target.comment) ||
          effType !== target.type ||
          (rot !== undefined && (rot?.getTime() ?? null) !== (target.rotationAt?.getTime() ?? null))
        if (changed) {
          const [row] = await tx
            .update(secrets)
            .set({
              key,
              valueEnc: next,
              comment: comment === undefined ? target.comment : comment,
              type: effType,
              rotationAt: rot === undefined ? target.rotationAt : rot,
              version: target.version + 1,
              updatedBy: c.userId,
              updatedAt: new Date(),
            })
            .where(eq(secrets.id, target.id))
            .returning()
          await version(tx, c, row, opts.action ?? (mode === "merge" ? "import" : "update"))
          byKey.delete(target.key)
          byKey.set(key, row)
          summary.updated.push(key)
        }
      }
      touched.push(target.id)

      if (op.tags) {
        const wanted = await tagIds(c, op.tags, tx)
        await tx.delete(secretTagLinks).where(eq(secretTagLinks.secretId, target.id))
        if (wanted.length)
          await tx
            .insert(secretTagLinks)
            .values(wanted.map((t) => ({ secretId: target!.id, tagId: t.id })))
      }
    }
    if (Object.keys(errors).length) throw bad("Some rows need fixing.", 422, errors)
    if (opts.dry) throw new DryRun()

    // References that loop back are refused, with the loop named.
    if (touched.length) {
      const all = await loadAll(c, tx)
      for (const i of all.items) {
        if (!touched.includes(i.row.id) || !hasRefs(i.value)) continue
        const r = expand(i.value, i.scope, all.lookup, selfId(i.scope, i.row.key))
        const cycle = r.errors.find((x) => x.kind === "cycle")
        if (cycle)
          throw bad(`${i.row.key}: ${cycle.message}`, 422, {
            [String(ops.findIndex((o) => o.key === i.row.key))]: cycle.message,
          })
      }
    }
  }
  try {
    if (opts.tx) await run(opts.tx)
    else await db.transaction(run)
  } catch (err) {
    if (!(err instanceof DryRun)) throw err
    return { ...summary, env: e.name, request: undefined }
  }
  const any = summary.created.length || summary.updated.length || summary.deleted.length
  if (any && !opts.tx) await changed(c, [envId], [...summary.created, ...summary.updated, ...summary.deleted])
  if (any && bypass)
    await audit("secrets_bypass", { detail: `${e.name}: an admin skipped review for ${names([...summary.created, ...summary.updated, ...summary.deleted])}`, env: e.name })
  return { ...summary, env: e.name, request: undefined as { id: string } | undefined }
}

// Soft deletes, keeping a version row. In a protected environment the deletes
// go into a change request instead (`requests` lists them).
export async function trashIds(c: Ctx, ids: string[]) {
  const mine = await owned(c, ids)
  mustWrite(c, mine.map((r) => r.envId))
  const prot = await protectedAmong(c, mine.map((r) => r.envId))
  const requests: string[] = []
  if (prot.size) {
    const { requestFromDeletes } = await import("./requests")
    for (const e of prot.values()) {
      const r = await requestFromDeletes(c, e, mine.filter((m) => m.envId === e.id))
      requests.push(r.id)
    }
    ids = mine.filter((m) => !prot.has(m.envId)).map((m) => m.id)
    if (!ids.length) return { keys: [] as string[], requests }
  }
  const rows = await db
    .update(secrets)
    .set({ deletedAt: new Date(), deletedBy: c.userId })
    .where(
      and(
        inArray(secrets.id, ids),
        eq(secrets.projectId, c.projectId),
        isNull(secrets.deletedAt),
        envScope(c)
      )
    )
    .returning()
  for (const r of rows) await version(db, c, r, "delete")
  await changed(c, rows.map((r) => r.envId), rows.map((r) => r.key))
  return { keys: rows.map((r) => r.key), requests }
}

// Protected environments among these ids, minus the ones this caller may bypass.
async function protectedAmong(c: Ctx, envIds: string[]) {
  const uniq = [...new Set(envIds)]
  if (!uniq.length) return new Map<string, typeof secretEnvs.$inferSelect>()
  const rows = await db.select().from(secretEnvs).where(and(inArray(secretEnvs.id, uniq), eq(secretEnvs.protected, true)))
  return new Map(rows.filter((e) => !(e.adminBypass && c.role === "admin")).map((e) => [e.id, e]))
}

export type RequiredKey = { key: string; kind: SchemaKind; pattern: string | null }

export async function requiredKeys(projectId: string) {
  const rows = await db.select().from(secretRequiredKeys).where(eq(secretRequiredKeys.projectId, projectId))
  return new Map<string, RequiredKey>(rows.map((r) => [r.key, { key: r.key, kind: r.kind, pattern: r.pattern }]))
}

async function owned(c: Ctx, ids: string[], tx: Q = db) {
  const rows = ids.length
    ? await tx
        .select()
        .from(secrets)
        .where(and(inArray(secrets.id, ids), eq(secrets.projectId, c.projectId), isNull(secrets.deletedAt), envScope(c)))
    : []
  return rows
}

export async function moveIds(c: Ctx, ids: string[], folderId: string | null) {
  const rows = await owned(c, ids)
  const envIds = new Set(rows.map((r) => r.envId))
  if (envIds.size !== 1) throw bad("Move secrets from one environment at a time.")
  const [envId] = envIds
  mustWrite(c, envIds)
  await refuseProtected(envId, "Moving secrets isn't done through change requests.", c)
  await folder(c, folderId, envId)
  await db.transaction(async (tx) => {
    const there = await tx
      .select({ key: secrets.key })
      .from(secrets)
      .where(
        and(
          eq(secrets.envId, envId),
          folderId ? eq(secrets.folderId, folderId) : isNull(secrets.folderId),
          isNull(secrets.deletedAt)
        )
      )
    const taken = new Set(there.map((r) => r.key))
    const clash = rows.find((r) => taken.has(r.key) && (r.folderId ?? null) !== folderId)
    if (clash) throw bad(`${clash.key} already exists in that folder.`)
    await tx
      .update(secrets)
      .set({ folderId, updatedAt: new Date(), updatedBy: c.userId })
      .where(inArray(secrets.id, rows.map((r) => r.id)))
  })
  await changed(c, [envId], rows.map((r) => r.key))
  return rows.map((r) => r.key)
}

// Copies into the same folder path of another environment (made if needed).
export async function copyIds(c: Ctx, ids: string[], toEnvId: string, overwrite: boolean) {
  const to = await wenv(c, toEnvId)
  const rows = await owned(c, ids)
  if ((await protectedAmong(c, [toEnvId])).has(toEnvId)) {
    const { requestFromCopy } = await import("./requests")
    const r = await requestFromCopy(c, to, rows, overwrite)
    return { copied: 0, skipped: 0, request: r }
  }
  const all = await foldersOf(c.projectId)
  const links = rows.length
    ? await db.select().from(secretTagLinks).where(inArray(secretTagLinks.secretId, rows.map((r) => r.id)))
    : []
  const done = { copied: 0, skipped: 0, request: undefined as { id: string } | undefined }
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const path = all.find((f) => f.id === r.folderId)?.path ?? ""
      const folderId = await ensurePath(c, toEnvId, path, tx)
      const [hit] = await tx
        .select()
        .from(secrets)
        .where(
          and(
            eq(secrets.envId, toEnvId),
            eq(secrets.key, r.key),
            folderId ? eq(secrets.folderId, folderId) : isNull(secrets.folderId),
            isNull(secrets.deletedAt)
          )
        )
      if (hit && !overwrite) {
        done.skipped++
        continue
      }
      const vals = { valueEnc: r.valueEnc, comment: r.comment, type: r.type, rotationAt: r.rotationAt }
      let target: Row
      if (hit) {
        ;[target] = await tx
          .update(secrets)
          .set({ ...vals, version: hit.version + 1, updatedBy: c.userId, updatedAt: new Date() })
          .where(eq(secrets.id, hit.id))
          .returning()
        await version(tx, c, target, "update")
      } else {
        ;[target] = await tx
          .insert(secrets)
          .values({ ...vals, projectId: c.projectId, envId: toEnvId, folderId, key: r.key, createdBy: c.userId, updatedBy: c.userId })
          .returning()
        await version(tx, c, target, "create")
      }
      done.copied++
      const mine = links.filter((l) => l.secretId === r.id)
      await tx.delete(secretTagLinks).where(eq(secretTagLinks.secretId, target.id))
      if (mine.length)
        await tx.insert(secretTagLinks).values(mine.map((l) => ({ secretId: target.id, tagId: l.tagId })))
    }
  })
  if (done.copied) await changed(c, [toEnvId], rows.map((r) => r.key))
  return done
}

// Adds to the current folder the keys that another environment has at the same
// path and this one lacks, empty (or with their values).
export async function copyKeys(c: Ctx, fromEnvId: string, envId: string, folderId: string | null, withValues: boolean) {
  await env(c, fromEnvId)
  await wenv(c, envId)
  const f = await folder(c, folderId, envId)
  const all = await foldersOf(c.projectId)
  const path = f ? (all.find((x) => x.id === f.id)?.path ?? "") : ""
  const src = all.find((x) => x.envId === fromEnvId && x.path === path)
  if (path && !src) return { created: [] as string[], env: "" }
  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.envId, fromEnvId),
        path ? eq(secrets.folderId, src!.id) : isNull(secrets.folderId),
        isNull(secrets.deletedAt)
      )
    )
  const ops: Op[] = rows.map((r) => ({
    key: r.key,
    value: withValues ? unseal(c, r.valueEnc) : "",
    comment: r.comment,
    type: r.type,
  }))
  const have = new Set((await listSecrets(c, envId, folderId)).map((s) => s.key))
  return applyOps(c, envId, folderId, ops.filter((o) => !have.has(o.key)), [], "merge", { via: "bulk" })
}

export async function tagIdsBulk(c: Ctx, ids: string[], add: string[], remove: string[]) {
  const rows = await owned(c, ids)
  mustWrite(c, rows.map((r) => r.envId))
  await db.transaction(async (tx) => {
    const adding = await tagIds(c, add, tx)
    for (const r of rows)
      if (adding.length)
        await tx
          .insert(secretTagLinks)
          .values(adding.map((t) => ({ secretId: r.id, tagId: t.id })))
          .onConflictDoNothing()
    const names = [...new Set(remove.map((n) => clean(n, 32)).filter(Boolean))]
    if (names.length && rows.length) {
      const drop = await tx
        .select({ id: secretTags.id })
        .from(secretTags)
        .where(and(eq(secretTags.projectId, c.projectId), inArray(secretTags.name, names)))
      if (drop.length)
        await tx.delete(secretTagLinks).where(
          and(
            inArray(secretTagLinks.secretId, rows.map((r) => r.id)),
            inArray(secretTagLinks.tagId, drop.map((d) => d.id))
          )
        )
    }
  })
  return rows.map((r) => r.key)
}

export async function setOverride(c: Ctx, secretId: string, value: string | null) {
  const [r] = await owned(c, [secretId])
  if (!r) throw bad("That secret doesn't exist.", 404)
  if (value === null)
    await db
      .delete(secretOverrides)
      .where(and(eq(secretOverrides.secretId, secretId), eq(secretOverrides.userId, c.userId)))
  else {
    const typeError = validateType(r.type, value)
    if (typeError) throw bad(typeError, 422)
    const valueEnc = seal(c, value)
    await db
      .insert(secretOverrides)
      .values({ secretId, userId: c.userId, valueEnc })
      .onConflictDoUpdate({ target: [secretOverrides.secretId, secretOverrides.userId], set: { valueEnc } })
  }
  await changed(c, [r.envId], [], true)
  return r.key
}

// ---- Import -----------------------------------------------------------------

// The folder's current values by key, for the import preview (compared, never sent).
export async function existingValues(c: Ctx, envId: string, folderId: string | null) {
  await env(c, envId)
  const all = await loadAll(c)
  const here = new Map(
    all.items
      .filter((i) => i.row.envId === envId && (i.row.folderId ?? null) === folderId)
      .map((i) => [i.row.key, i.value])
  )
  return here
}

// ---- Trash ------------------------------------------------------------------

export async function listTrash(c: Ctx) {
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.projectId, c.projectId), isNotNull(secrets.deletedAt), envScope(c)))
    .orderBy(desc(secrets.deletedAt))
    .limit(500)
  const [envs, folders, people] = await Promise.all([
    db.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId)),
    foldersOf(c.projectId),
    db.select({ id: user.id, name: user.name }).from(user),
  ])
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    env: envs.find((e) => e.id === r.envId)?.name ?? "",
    folder: folders.find((f) => f.id === r.folderId)?.path ?? "",
    deletedAt: r.deletedAt!.toISOString(),
    deletedBy: people.find((p) => p.id === r.deletedBy)?.name ?? null,
  }))
}

export async function restoreIds(c: Ctx, ids: string[]) {
  const rows = await db
    .select()
    .from(secrets)
    .where(and(inArray(secrets.id, ids), eq(secrets.projectId, c.projectId), isNotNull(secrets.deletedAt), envScope(c)))
  const restored: string[] = []
  const skipped: string[] = []
  mustWrite(c, rows.map((r) => r.envId))
  for (const e of new Set(rows.map((r) => r.envId))) await refuseProtected(e, "Restore secrets there through a change request.", c)
  for (const r of rows) {
    // A live secret with the same key in the same place keeps the spot.
    const [live] = await db
      .select({ id: secrets.id })
      .from(secrets)
      .where(
        and(
          eq(secrets.envId, r.envId),
          eq(secrets.key, r.key),
          r.folderId ? eq(secrets.folderId, r.folderId) : isNull(secrets.folderId),
          isNull(secrets.deletedAt)
        )
      )
    if (live) {
      skipped.push(r.key)
      continue
    }
    const [row] = await db
      .update(secrets)
      .set({ deletedAt: null, deletedBy: null, version: r.version + 1, updatedAt: new Date(), updatedBy: c.userId })
      .where(eq(secrets.id, r.id))
      .returning()
    await version(db, c, row, "restore")
    restored.push(r.key)
  }
  if (restored.length) await changed(c, rows.map((r) => r.envId), restored)
  return { restored, skipped }
}

export async function purgeIds(c: Ctx, ids: string[]) {
  const mine = await db
    .select({ envId: secrets.envId })
    .from(secrets)
    .where(and(inArray(secrets.id, ids), eq(secrets.projectId, c.projectId), isNotNull(secrets.deletedAt), envScope(c)))
  mustWrite(c, mine.map((r) => r.envId))
  for (const e of new Set(mine.map((r) => r.envId))) await refuseProtected(e, "Its trash can't be emptied by hand.", c)
  const rows = await db
    .delete(secrets)
    .where(and(inArray(secrets.id, ids), eq(secrets.projectId, c.projectId), isNotNull(secrets.deletedAt), envScope(c)))
    .returning({ key: secrets.key })
  return rows.map((r) => r.key)
}
