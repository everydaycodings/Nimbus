// Change requests: edits to a protected environment wait here for approval, then
// merge as new versions. Values stay sealed (the project key) until someone reveals them.
import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  secretChangeRequests,
  secretEnvs,
  secretMembers,
  secretReviews,
  secrets,
  user,
  type CrChange,
} from "@/lib/db/schema"
import { reviewState } from "./gov-rules"
import { names } from "./format"
import { requestOpened, requestResult } from "./notices"
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

type Env = typeof secretEnvs.$inferSelect
type Row = typeof secrets.$inferSelect

const bad = (m: string, status = 400) => new SecretsError(status, m)

async function liveIn(envId: string) {
  return db.select().from(secrets).where(and(eq(secrets.envId, envId), isNull(secrets.deletedAt)))
}

async function authorOf(c: Ctx) {
  if (c.actor) return c.actor
  const [u] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, c.userId))
  return { id: c.userId, name: u?.name || u?.email || "A member" }
}

export async function requestFromChanges(c: Ctx, e: Env, changes: CrChange[], via: string, note?: string) {
  if (!changes.length) return undefined
  const a = await authorOf(c)
  const [row] = await db
    .insert(secretChangeRequests)
    .values({ projectId: c.projectId, envId: e.id, authorId: a.id, authorName: a.name, source: via, note: note ?? null, changes })
    .returning()
  await audit("secrets_request", {
    detail: `${e.name}: ${changes.length} change${changes.length === 1 ? "" : "s"} sent for review (${via}): ${names(changes.map((x) => x.key))}`,
    env: e.name,
  })
  await requestOpened(row, e, changes.length)
  return { id: row.id }
}

export async function requestFromOps(
  c: Ctx,
  e: Env,
  folderId: string | null,
  ops: Op[],
  deletes: string[],
  via: string,
  dry: { created: string[]; updated: string[]; deleted: string[] }
) {
  const folders = await foldersOf(c.projectId)
  const folder = folderId ? (folders.find((f) => f.id === folderId)?.path ?? "") : ""
  const here = (await liveIn(e.id)).filter((r) => (r.folderId ?? null) === folderId)
  const byId = new Map(here.map((r) => [r.id, r]))
  const byKey = new Map(here.map((r) => [r.key, r]))
  const touched = new Set([...dry.created, ...dry.updated])
  const changes: CrChange[] = []
  for (const op of ops) {
    const key = op.key.trim()
    if (!touched.has(key)) continue
    const target = op.id ? byId.get(op.id) : byKey.get(key)
    changes.push({
      ...(target && { id: target.id }),
      folder,
      key,
      action: "set",
      base: target?.version ?? 0,
      ...(op.value !== undefined && { valueEnc: seal(c, op.value) }),
      ...(op.comment !== undefined && { comment: op.comment }),
      ...(op.type !== undefined && { type: op.type }),
      ...(op.rotationAt !== undefined && { rotationAt: op.rotationAt }),
      ...(op.tags !== undefined && { tags: op.tags }),
    })
  }
  for (const id of deletes) {
    const r = byId.get(id)
    if (r) changes.push({ id: r.id, folder, key: r.key, action: "delete", base: r.version })
  }
  return requestFromChanges(c, e, changes, via)
}

export async function requestFromDeletes(c: Ctx, e: Env, rows: Row[]) {
  const folders = await foldersOf(c.projectId)
  const r = await requestFromChanges(
    c,
    e,
    rows.map((x) => ({
      id: x.id,
      folder: folders.find((f) => f.id === x.folderId)?.path ?? "",
      key: x.key,
      action: "delete" as const,
      base: x.version,
    })),
    "bulk"
  )
  return r!
}

// Copies from other environments into a protected one.
export async function requestFromCopy(c: Ctx, e: Env, rows: Row[], overwrite: boolean) {
  const folders = await foldersOf(c.projectId)
  const there = await liveIn(e.id)
  const changes: CrChange[] = []
  for (const r of rows) {
    const path = folders.find((f) => f.id === r.folderId)?.path ?? ""
    const target = folders.find((f) => f.envId === e.id && f.path === path)
    const hit = there.find((t) => t.key === r.key && (t.folderId ?? null) === (target?.id ?? null))
    if (hit && !overwrite) continue
    changes.push({
      ...(hit && { id: hit.id }),
      folder: path,
      key: r.key,
      action: "set",
      base: hit?.version ?? 0,
      valueEnc: r.valueEnc,
      comment: r.comment,
      type: r.type,
      rotationAt: r.rotationAt?.toISOString() ?? null,
    })
  }
  if (!changes.length) throw bad("Those secrets already exist there.")
  return (await requestFromChanges(c, e, changes, "bulk"))!
}

// ---- Reading ----------------------------------------------------------------

const visible = (c: Ctx, envId: string) => !c.envs || c.envs.includes(envId)

async function load(c: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad("That request isn't here.", 404)
  const [r] = await db
    .select()
    .from(secretChangeRequests)
    .where(and(eq(secretChangeRequests.id, id), eq(secretChangeRequests.projectId, c.projectId)))
  if (!r || !visible(c, r.envId)) throw bad("That request isn't here.", 404)
  const [e] = await db.select().from(secretEnvs).where(eq(secretEnvs.id, r.envId))
  return { r, e }
}

async function approverSet(e: Env) {
  if (e.approverIds?.length) return new Set(e.approverIds)
  const rows = await db
    .select({ u: secretMembers.userId })
    .from(secretMembers)
    .where(and(eq(secretMembers.projectId, e.projectId), eq(secretMembers.role, "admin")))
  return new Set(rows.map((x) => x.u))
}

export async function listRequests(c: Ctx, status: "open" | "all") {
  const rows = await db
    .select()
    .from(secretChangeRequests)
    .where(and(eq(secretChangeRequests.projectId, c.projectId), status === "open" ? eq(secretChangeRequests.status, "open") : undefined))
    .orderBy(desc(secretChangeRequests.createdAt))
    .limit(200)
  const mine = rows.filter((r) => visible(c, r.envId))
  const envs = await db.select().from(secretEnvs).where(eq(secretEnvs.projectId, c.projectId))
  const reviews = mine.length
    ? await db.select().from(secretReviews).where(inArray(secretReviews.requestId, mine.map((r) => r.id)))
    : []
  return Promise.all(
    mine.map(async (r) => {
      const e = envs.find((x) => x.id === r.envId)!
      const set = await approverSet(e)
      const mineReviews = reviews.filter((x) => x.requestId === r.id)
      return {
        id: r.id,
        env: e.name,
        author: r.authorName,
        source: r.source,
        status: r.status,
        count: r.changes.length,
        keys: r.changes.slice(0, 4).map((x) => x.key),
        approvals: mineReviews.filter((x) => x.decision === "approve" && x.userId !== r.authorId && set.has(x.userId)).length,
        required: e.approvalsRequired,
        createdAt: r.createdAt.toISOString(),
      }
    })
  )
}

async function analyze(c: Ctx, e: Env, changes: CrChange[]) {
  const folders = await foldersOf(c.projectId)
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  const live = await liveIn(e.id)
  const byId = new Map(live.map((r) => [r.id, r]))
  const byPathKey = new Map(live.map((r) => [`${r.folderId ? (pathOf.get(r.folderId) ?? "") : ""}\0${r.key}`, r]))
  return changes.map((ch, index) => {
    const cur = ch.id ? byId.get(ch.id) : byPathKey.get(`${ch.folder}\0${ch.key}`)
    const curPath = cur ? (cur.folderId ? (pathOf.get(cur.folderId) ?? "") : "") : null
    let conflict: string | null = null
    const fields: string[] = []
    if (ch.action === "delete") {
      if (cur && cur.version !== ch.base) conflict = "Changed since this request was made."
    } else if (ch.id) {
      if (!cur) conflict = "Deleted since this request was made."
      else if (cur.version !== ch.base) conflict = "Changed since this request was made."
      else if (curPath !== ch.folder) conflict = "Moved to another folder since this request was made."
    } else if (cur) conflict = "A secret with this key was added since this request was made."
    if (ch.action === "set" && cur) {
      if (ch.key !== cur.key) fields.push("key")
      if (ch.valueEnc !== undefined && unseal(c, ch.valueEnc) !== unseal(c, cur.valueEnc)) fields.push("value")
      if (ch.comment !== undefined && (ch.comment ?? null) !== cur.comment) fields.push("comment")
      if (ch.type !== undefined && (ch.type ?? null) !== cur.type) fields.push("type")
      if (ch.rotationAt !== undefined && (ch.rotationAt ? new Date(ch.rotationAt).getTime() : null) !== (cur.rotationAt?.getTime() ?? null)) fields.push("reminder")
      if (ch.tags !== undefined) fields.push("tags")
    }
    return {
      index,
      key: ch.key,
      folder: ch.folder,
      kind: ch.action === "delete" ? ("delete" as const) : cur ? ("change" as const) : ("add" as const),
      fields,
      conflict,
      // A delete of something already gone has nothing to do.
      gone: ch.action === "delete" && !cur,
    }
  })
}

export async function requestDetail(c: Ctx, id: string) {
  const { r, e } = await load(c, id)
  const entries = await analyze(c, e, r.changes)
  const set = await approverSet(e)
  const reviews = await db
    .select({ userId: secretReviews.userId, decision: secretReviews.decision, at: secretReviews.createdAt, name: user.name })
    .from(secretReviews)
    .innerJoin(user, eq(user.id, secretReviews.userId))
    .where(eq(secretReviews.requestId, id))
  const approvers = set.size
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...set]))
    : []
  const state = reviewState(e.approvalsRequired, set, r.authorId, reviews)
  const open = r.status === "open"
  return {
    id: r.id,
    env: { id: e.id, name: e.name, slug: e.slug },
    author: r.authorName,
    mine: r.authorId === c.userId,
    source: r.source,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    required: e.approvalsRequired,
    approvers,
    reviews: reviews.map((v) => ({ userId: v.userId, name: v.name, decision: v.decision, at: v.at.toISOString() })),
    state,
    entries,
    conflicts: entries.filter((x) => x.conflict).map((x) => `${x.key}: ${x.conflict}`),
    canReview: open && set.has(c.userId) && r.authorId !== c.userId,
    canMerge: open && state === "approved" && (r.authorId === c.userId || set.has(c.userId) || c.role === "admin"),
    canClose: open && (r.authorId === c.userId || c.role === "admin"),
  }
}

// Old and new value of one change, for the diff's reveal (the route logs it).
export async function revealChange(c: Ctx, id: string, index: number) {
  const { r, e } = await load(c, id)
  const ch = r.changes[index]
  if (!ch) throw bad("That change isn't here.", 404)
  const pathOf = new Map((await foldersOf(c.projectId)).map((f) => [f.id, f.path]))
  const live = (await liveIn(e.id)).find((x) =>
    ch.id ? x.id === ch.id : x.key === ch.key && (x.folderId ? pathOf.get(x.folderId) : "") === ch.folder
  )
  return {
    key: ch.key,
    old: live ? unseal(c, live.valueEnc) : null,
    new: ch.valueEnc !== undefined ? unseal(c, ch.valueEnc) : null,
  }
}

// ---- Acting on a request ------------------------------------------------------

export async function reviewRequest(c: Ctx, id: string, decision: "approve" | "reject") {
  const { r, e } = await load(c, id)
  if (r.status !== "open") throw bad("That request is already closed.", 409)
  const set = await approverSet(e)
  if (r.authorId === c.userId) throw bad("You can't review your own request.", 403)
  if (!set.has(c.userId)) throw bad("You aren't one of this environment's approvers.", 403)
  await db
    .insert(secretReviews)
    .values({ requestId: id, userId: c.userId, decision })
    .onConflictDoUpdate({ target: [secretReviews.requestId, secretReviews.userId], set: { decision, createdAt: new Date() } })
  const reviews = await db.select().from(secretReviews).where(eq(secretReviews.requestId, id))
  const state = reviewState(e.approvalsRequired, set, r.authorId, reviews)
  if (state === "rejected") {
    await db.update(secretChangeRequests).set({ status: "rejected", resolvedAt: new Date(), resolvedBy: c.userId }).where(eq(secretChangeRequests.id, id))
    await requestResult(r, e.name, "rejected", c.userId)
  } else if (state === "approved") await requestResult(r, e.name, "approved", c.userId)
  await audit("secrets_review", { detail: `${e.name}: ${decision === "approve" ? "approved" : "rejected"} ${r.authorName}'s request`, env: e.name })
  return state
}

export async function closeRequest(c: Ctx, id: string) {
  const { r, e } = await load(c, id)
  if (r.status !== "open") throw bad("That request is already closed.", 409)
  if (r.authorId !== c.userId && c.role !== "admin") throw bad("Only its author or an admin can close it.", 403)
  await db.update(secretChangeRequests).set({ status: "closed", resolvedAt: new Date(), resolvedBy: c.userId }).where(eq(secretChangeRequests.id, id))
  await audit("secrets_review", { detail: `${e.name}: closed ${r.authorName}'s request`, env: e.name })
}

export async function mergeRequest(c: Ctx, id: string) {
  const d = await requestDetail(c, id)
  if (d.status !== "open") throw bad("That request is already closed.", 409)
  if (!d.canMerge) throw bad(d.state === "approved" ? "You can't merge this request." : "It needs more approvals first.", 403)
  if (d.conflicts.length) throw bad(`Out of date, so it can't merge: ${d.conflicts.slice(0, 3).join(" ")}`, 409)
  const { r, e } = await load(c, id)
  const live = await liveIn(e.id)
  const folders = await foldersOf(c.projectId)
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  // Approval is what authorises this; the merger's own environment access doesn't matter.
  const m: Ctx = { ...c, role: "admin", envs: null, writeEnvs: null }
  const groups = new Map<string, CrChange[]>()
  for (const ch of r.changes) groups.set(ch.folder, [...(groups.get(ch.folder) ?? []), ch])
  try {
    await db.transaction(async (tx) => {
      for (const [path, list] of groups) {
        const folderId = await ensurePath(m, e.id, path, tx)
        const ops: Op[] = []
        const deletes: string[] = []
        for (const ch of list) {
          const cur = ch.id
            ? live.find((x) => x.id === ch.id)
            : live.find((x) => x.key === ch.key && (x.folderId ? pathOf.get(x.folderId) : "") === path)
          if (ch.action === "delete") {
            if (cur) deletes.push(cur.id)
            continue
          }
          ops.push({
            ...(cur && { id: cur.id }),
            key: ch.key,
            ...(ch.valueEnc !== undefined && { value: unseal(c, ch.valueEnc) }),
            ...(ch.comment !== undefined && { comment: ch.comment }),
            ...(ch.type !== undefined && { type: ch.type }),
            ...(ch.rotationAt !== undefined && { rotationAt: ch.rotationAt }),
            ...(ch.tags !== undefined && { tags: ch.tags }),
          })
        }
        await applyOps(m, e.id, folderId, ops, deletes, "merge", { direct: true, tx })
      }
      await tx
        .update(secretChangeRequests)
        .set({ status: "merged", resolvedAt: new Date(), resolvedBy: c.userId })
        .where(eq(secretChangeRequests.id, id))
    })
  } catch (err) {
    if (err instanceof SecretsError && err.fields)
      throw bad(`It can't merge: ${Object.values(err.fields).slice(0, 3).join(" ")}`, 422)
    throw err
  }
  await changed(c, [e.id], r.changes.map((x) => x.key))
  await audit("secrets_merge", { detail: `${e.name}: merged ${r.authorName}'s request (${names(r.changes.map((x) => x.key))})`, env: e.name })
  await requestResult(r, e.name, "merged", c.userId)
}
