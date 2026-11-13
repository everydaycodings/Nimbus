// Per-secret history, the change timeline of an environment, and rolling an
// environment or folder back to a moment. A rollback never rewrites history:
// it writes new versions (or a change request, in a protected environment).
import "server-only"

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretEnvs, secretVersions, secrets, user, type CrChange } from "@/lib/db/schema"
import { names } from "./format"
import { groupTimeline, planRollback, type RollbackStep, type Shape } from "./gov-rules"
import { requestFromChanges } from "./requests"
import {
  SecretsError,
  applyOps,
  changed,
  ensurePath,
  foldersOf,
  seal,
  unseal,
  type Ctx,
  type Op,
} from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m, undefined)

async function secretOf(c: Ctx, secretId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(secretId)) throw bad("That secret isn't here.", 404)
  const [s] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.projectId, c.projectId)))
  if (!s || (c.envs && !c.envs.includes(s.envId))) throw bad("That secret isn't here.", 404)
  return s
}

// Every version of one secret, newest first. Values stay sealed: `valueChanged`
// says whether the value moved from the version before.
export async function secretHistory(c: Ctx, secretId: string) {
  const s = await secretOf(c, secretId)
  const rows = await db
    .select({
      id: secretVersions.id,
      version: secretVersions.version,
      action: secretVersions.action,
      at: secretVersions.createdAt,
      comment: secretVersions.comment,
      type: secretVersions.type,
      enc: secretVersions.valueEnc,
      by: user.name,
    })
    .from(secretVersions)
    .leftJoin(user, eq(user.id, secretVersions.changedBy))
    .where(eq(secretVersions.secretId, secretId))
    .orderBy(asc(secretVersions.version), asc(secretVersions.createdAt))
  let prev: string | null = null
  const out = rows.map((r) => {
    const value = unseal(c, r.enc)
    const valueChanged = prev !== null && prev !== value
    prev = value
    return { id: r.id, version: r.version, action: r.action, at: r.at.toISOString(), by: r.by, comment: r.comment, type: r.type, valueChanged: r.action === "create" ? true : valueChanged }
  })
  return { key: s.key, deleted: Boolean(s.deletedAt), version: s.version, versions: out.reverse() }
}

// Values of chosen versions and the current one, for the diff. The route logs it.
export async function versionValues(c: Ctx, secretId: string, versionIds: string[]) {
  const s = await secretOf(c, secretId)
  const rows = versionIds.length
    ? await db
        .select()
        .from(secretVersions)
        .where(and(eq(secretVersions.secretId, secretId), inArray(secretVersions.id, versionIds)))
    : []
  return {
    key: s.key,
    current: unseal(c, s.valueEnc),
    versions: rows.map((r) => ({ id: r.id, value: unseal(c, r.valueEnc) })),
  }
}

export async function restoreVersion(c: Ctx, secretId: string, versionId: string) {
  const s = await secretOf(c, secretId)
  if (s.deletedAt) throw bad("It's in the trash. Restore it from there first.", 409)
  const [v] = await db
    .select()
    .from(secretVersions)
    .where(and(eq(secretVersions.id, versionId), eq(secretVersions.secretId, secretId)))
  if (!v) throw bad("That version isn't here.", 404)
  const r = await applyOps(
    c,
    s.envId,
    s.folderId,
    [{ id: s.id, key: s.key, value: unseal(c, v.valueEnc), comment: v.comment, type: v.type }],
    [],
    "strict",
    { action: "restore", via: "restore" }
  )
  await audit("secrets_restore_version", { detail: `${s.key}: went back to version ${v.version}${r.request ? " (sent for review)" : ""}` })
  return { key: s.key, version: v.version, request: r.request }
}

// ---- Timeline ----------------------------------------------------------------

async function scopeFolders(c: Ctx, envId: string, folderId: string | null) {
  if (!folderId) return null
  const all = await foldersOf(c.projectId)
  const f = all.find((x) => x.id === folderId && x.envId === envId)
  if (!f) throw bad("That folder doesn't exist.", 404)
  return new Set(all.filter((x) => x.envId === envId && (x.path === f.path || x.path.startsWith(`${f.path}/`))).map((x) => x.id))
}

async function envOf(c: Ctx, envId: string) {
  const [e] = await db
    .select()
    .from(secretEnvs)
    .where(and(eq(secretEnvs.id, envId), eq(secretEnvs.projectId, c.projectId)))
  if (!e || (c.envs && !c.envs.includes(e.id))) throw bad("That environment doesn't exist.", 404)
  return e
}

export async function timeline(c: Ctx, envId: string, folderId: string | null) {
  await envOf(c, envId)
  const scope = await scopeFolders(c, envId, folderId)
  const rows = await db
    .select({
      by: secretVersions.changedBy,
      at: secretVersions.createdAt,
      action: secretVersions.action,
      key: sql<string>`coalesce(${secretVersions.key}, ${secrets.key})`,
      folder: sql<string | null>`coalesce(${secretVersions.folderId}, ${secrets.folderId})`,
    })
    .from(secretVersions)
    .innerJoin(secrets, eq(secrets.id, secretVersions.secretId))
    .where(eq(secrets.envId, envId))
    .orderBy(desc(secretVersions.createdAt))
    .limit(1000)
  const moments = groupTimeline(rows.filter((r) => !scope || (r.folder && scope.has(r.folder))).map((r) => ({ ...r, by: r.by })))
  const people = await db.select({ id: user.id, name: user.name }).from(user)
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  return moments.slice(0, 100).map((m) => ({ ...m, by: m.by ? (nameOf.get(m.by) ?? "Someone") : "A token or the system", keys: m.keys.slice(0, 8), more: Math.max(0, m.keys.length - 8) }))
}

// ---- Rollback ------------------------------------------------------------------

export async function rollback(c: Ctx, envId: string, folderId: string | null, at: string, apply: boolean) {
  const e = await envOf(c, envId)
  const when = new Date(at)
  if (isNaN(+when)) throw bad("Pick a moment from the timeline.")
  const until = new Date(when.getTime() + 1)
  const scope = await scopeFolders(c, envId, folderId)
  const folders = await foldersOf(c.projectId)
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  const path = (id: string | null) => (id ? (pathOf.get(id) ?? "") : "")

  const all = await db.select().from(secrets).where(eq(secrets.envId, envId))
  const versions = all.length
    ? await db
        .select()
        .from(secretVersions)
        .where(inArray(secretVersions.secretId, all.map((s) => s.id)))
        .orderBy(desc(secretVersions.version), desc(secretVersions.createdAt))
    : []
  const then = new Map<string, Shape | null>()
  const now = new Map<string, Shape>()
  const rowById = new Map(all.map((s) => [s.id, s]))
  for (const s of all) {
    // The last version written at or before the moment.
    const v = versions.find((x) => x.secretId === s.id && x.createdAt < until)
    const folderAtThen = v ? (v.folderId ?? s.folderId) : s.folderId
    const live = !s.deletedAt
    const inScope = !scope || (folderAtThen && scope.has(folderAtThen)) || (live && s.folderId && scope.has(s.folderId))
    if (!inScope) continue
    then.set(
      s.id,
      v && v.action !== "delete"
        ? { key: v.key ?? s.key, folder: path(folderAtThen), value: unseal(c, v.valueEnc), comment: v.comment, type: v.type }
        : null
    )
    if (live) now.set(s.id, { key: s.key, folder: path(s.folderId), value: unseal(c, s.valueEnc), comment: s.comment, type: s.type })
  }
  const steps = planRollback(then, now)
  const summary = steps.map((s) => ({
    kind: s.kind,
    key: s.kind === "add" ? s.to.key : s.from.key,
    folder: s.kind === "add" ? s.to.folder : s.from.folder,
    fields: s.kind === "change" ? s.fields : [],
  }))
  if (!apply) return { steps: summary, protected: e.protected }
  if (!steps.length) throw bad("Nothing would change: it's already the way it was then.")

  const label = `back to ${when.toISOString().slice(0, 19).replace("T", " ")} UTC`
  if (e.protected && !(e.adminBypass && c.role === "admin")) {
    const changes: CrChange[] = steps.map((s: RollbackStep) =>
      s.kind === "delete"
        ? { id: s.id, folder: s.from.folder, key: s.from.key, action: "delete", base: rowById.get(s.id)!.version }
        : {
            ...(s.kind === "change" && { id: s.id }),
            folder: s.to.folder,
            key: s.to.key,
            action: "set",
            base: s.kind === "change" ? rowById.get(s.id)!.version : 0,
            valueEnc: seal(c, s.to.value),
            comment: s.to.comment,
            type: s.to.type,
          }
    )
    const request = await requestFromChanges(c, e, changes, "rollback", label)
    return { steps: summary, protected: true, request }
  }

  const groups = new Map<string, { ops: Op[]; deletes: string[] }>()
  const group = (p: string) => groups.get(p) ?? groups.set(p, { ops: [], deletes: [] }).get(p)!
  for (const s of steps) {
    if (s.kind === "delete") group(s.from.folder).deletes.push(s.id)
    else if (s.kind === "add") group(s.to.folder).ops.push({ key: s.to.key, value: s.to.value, comment: s.to.comment, type: s.to.type })
    else group(s.from.folder).ops.push({ id: s.id, key: s.to.key, value: s.to.value, comment: s.to.comment, type: s.to.type })
  }
  await db.transaction(async (tx) => {
    for (const [p, g] of groups) {
      const fid = await ensurePath(c, envId, p, tx)
      await applyOps(c, envId, fid, g.ops, g.deletes, "merge", { direct: true, tx, action: "rollback" })
    }
  })
  await changed(c, [envId], summary.map((x) => x.key))
  await audit("secrets_rollback", { detail: `${e.name}${folderId ? ` / ${path(folderId)}` : ""}: rolled ${label} (${names(summary.map((x) => x.key))})`, env: e.name })
  return { steps: summary, protected: false }
}
