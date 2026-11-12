import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { record } from "@/lib/activity"
import { retentionCutoff } from "@/lib/activity-rules"
import { db } from "@/lib/db"
import {
  activity,
  nodes,
  pointRestores,
  settings,
  type PointRestoreUndo,
} from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { earliestAfter, restoredName, undoable, type Hist } from "@/lib/point-restore-rules"
import { makeCurrent } from "@/lib/services/uploads"
import type { Me } from "@/lib/session"
import { GONE, NOT_ALLOWED } from "@/lib/tree-ops"
import { restoreNode, trashNodes } from "@/lib/tree"
import { isClash } from "@/lib/uploads"

export type RestoreItem = {
  id: string
  name: string
  kind: "file" | "folder"
  /** "to Reports", "Version 2", why it can't come back… */
  detail: string | null
}
export type RestorePreview = {
  at: string
  trash: RestoreItem[]
  versions: RestoreItem[]
  renames: RestoreItem[]
  moves: RestoreItem[]
  blocked: RestoreItem[]
  /** Nodes whose renames or moves came before they were tracked (phase 17). */
  untracked: number
}
export type Applied = Omit<RestorePreview, "untracked"> & { id?: string; error?: string }

type N = {
  id: string
  parentId: string | null
  name: string
  kind: "file" | "folder"
  trashedAt: number | null
  currentVersionId: string | null
}

const NOT_OWNER = "Only the owner can restore to a point in time."
const ONLY_OWN = "Restoring to a point in time isn't available inside the Vault."

// Oldest time the activity log can vouch for.
export async function restoreWindow() {
  const [s] = await db.select({ days: settings.activityRetentionDays }).from(settings)
  return { earliest: retentionCutoff(s?.days ?? null)?.toISOString() ?? null }
}

async function scopeOf(me: Me, folderId: string | null, at: Date) {
  if (folderId !== null) {
    if (!UUID.test(folderId)) return GONE
    const [f] = await db
      .select({ ownerId: nodes.ownerId, kind: nodes.kind, vaultId: nodes.vaultId, trashedAt: nodes.trashedAt })
      .from(nodes)
      .where(eq(nodes.id, folderId))
    if (!f || f.kind !== "folder" || f.trashedAt) return GONE
    if (f.ownerId !== me.id) return NOT_OWNER
    if (f.vaultId) return ONLY_OWN
  }
  if (!(at.getTime() < Date.now())) return "Pick a time in the past."
  const { earliest } = await restoreWindow()
  if (earliest && at.getTime() < Date.parse(earliest))
    return "That's further back than the activity history goes. Pick a later time."
  return null
}

const COLS = {
  id: nodes.id,
  parentId: nodes.parentId,
  name: nodes.name,
  kind: nodes.kind,
  trashedAt: nodes.trashedAt,
  currentVersionId: nodes.currentVersionId,
  createdAt: nodes.createdAt,
}

// Works out what restoring would change, against the tree as it is now. Preview and apply both
// run it, so what you see is what the server will try.
// ponytail: loads the whole subtree (or every non-vault node for My files) into memory.
async function plan(me: Me, folderId: string | null, at: Date) {
  const t = at.getTime()
  const base = and(eq(nodes.ownerId, me.id), isNull(nodes.vaultId))
  const inScope =
    folderId === null
      ? base
      : and(
          base,
          sql`${nodes.id} in (
            with recursive d as (
              select id from nodes where id = ${folderId}
              union all
              select n.id from nodes n join d on n.parent_id = d.id
            ) select id from d)`
        )
  const rows = await db.select(COLS).from(nodes).where(inScope)
  const map = new Map<string, N & { createdAt: number }>(
    rows.map((r) => [
      r.id,
      { ...r, trashedAt: r.trashedAt?.getTime() ?? null, createdAt: r.createdAt.getTime() },
    ])
  )

  const evs = await db
    .select({
      nodeId: activity.nodeId,
      type: activity.type,
      at: activity.at,
      fromName: activity.fromName,
      fromParentId: activity.fromParentId,
    })
    .from(activity)
    .innerJoin(nodes, eq(nodes.id, activity.nodeId))
    .where(
      and(base, inArray(activity.type, ["rename", "move"]), sql`${activity.at} > ${at.toISOString()}`)
    )
  const hist: Hist[] = evs.map((e) => ({
    nodeId: e.nodeId,
    type: e.type as Hist["type"],
    at: e.at.getTime(),
    fromName: e.fromName,
    fromParentId: e.fromParentId,
  }))
  const early = earliestAfter(hist, t)

  // Things moved out of the folder since then belong to its past too.
  const out = [...early.parents]
    .filter(([id, to]) => !map.has(id) && to && map.has(to))
    .map(([id]) => id)
  if (out.length)
    for (const r of await db.select(COLS).from(nodes).where(and(base, inArray(nodes.id, out))))
      map.set(r.id, { ...r, trashedAt: r.trashedAt?.getTime() ?? null, createdAt: r.createdAt.getTime() })

  const kids = new Map<string | null, string[]>()
  for (const n of map.values()) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id])

  // Names taken in a folder (lowercase -> node), loaded when first needed and kept current as we plan.
  const taken = new Map<string | null, Map<string, string>>()
  async function names(parent: string | null) {
    let m = taken.get(parent)
    if (!m) {
      const sib = await db
        .select({ id: nodes.id, name: nodes.name })
        .from(nodes)
        .where(
          and(base, isNull(nodes.trashedAt), parent ? eq(nodes.parentId, parent) : isNull(nodes.parentId))
        )
      m = new Map(sib.map((s) => [s.name.toLowerCase(), s.id]))
      taken.set(parent, m)
    }
    return m
  }
  // A free name for `n` in `parent`: its own if possible, else "(restored)".
  async function fit(n: N, parent: string | null, want: string) {
    const m = await names(parent)
    const clash = (x: string) => {
      const who = m.get(x.toLowerCase())
      return who !== undefined && who !== n.id
    }
    if (!clash(want)) return want
    const all = new Set([...m.keys()])
    return restoredName(want, all, n.kind === "folder")
  }
  const place = async (n: N, parent: string | null, name: string) => {
    ;(await names(n.parentId)).delete(n.name.toLowerCase())
    ;(await names(parent)).set(name.toLowerCase(), n.id)
  }

  const item = (n: N, detail: string | null = null): RestoreItem => ({ id: n.id, name: n.name, kind: n.kind, detail })
  const nameOf = (id: string | null) => (id === null ? "My files" : (map.get(id)?.name ?? "its old folder"))

  // 1. Trash roots, latest first, so a folder is back before what was trashed from it earlier.
  const trash: { n: N; name: string | null }[] = []
  const roots = [...map.values()]
    .filter(
      (n) =>
        n.trashedAt !== null &&
        n.trashedAt > t &&
        n.createdAt <= t &&
        (n.parentId === null || map.get(n.parentId)?.trashedAt !== n.trashedAt)
    )
    .sort((a, b) => b.trashedAt! - a.trashedAt!)
  for (const n of roots) {
    const ts = n.trashedAt
    // Its folder is still in the Trash, or isn't ours to see: it returns to My files.
    const pn = n.parentId ? map.get(n.parentId) : null
    const parent = pn && pn.trashedAt === null ? n.parentId : null
    const name = await fit(n, parent, n.name)
    n.parentId = parent
    for (const stack = [n.id]; stack.length; ) {
      const c = map.get(stack.pop()!)!
      if (c.id !== n.id && c.trashedAt !== ts) continue
      c.trashedAt = null
      stack.push(...(kids.get(c.id) ?? []))
    }
    ;(await names(parent)).set(name.toLowerCase(), n.id)
    trash.push({ n, name: name === n.name ? null : name })
  }

  // 2. Files whose current version came after the time and that have an older one.
  const versions: { n: N; to: string; number: number }[] = []
  {
    const rows2 = await db.execute<{ node_id: string; id: string; number: number }>(sql`
      select distinct on (v.node_id) v.node_id, v.id, v.number
      from file_versions v
      join nodes n on n.id = v.node_id and n.owner_id = ${me.id} and n.vault_id is null
      join file_versions cur on cur.id = n.current_version_id
      where cur.created_at > ${at.toISOString()} and v.created_at <= ${at.toISOString()}
      order by v.node_id, v.created_at desc`)
    for (const r of rows2) {
      const n = map.get(r.node_id)
      if (n && n.trashedAt === null && n.createdAt <= t && n.currentVersionId) versions.push({ n, to: r.id, number: r.number })
    }
  }

  // 3. Renames and moves, one change per node.
  const renames: RestoreItem[] = []
  const moves: RestoreItem[] = []
  const blocked: RestoreItem[] = []
  const edits: { n: N; parentId: string | null; name: string; moved: boolean }[] = []
  for (const n of map.values()) {
    // Newer things are kept as they are.
    if (n.trashedAt !== null || n.createdAt > t) continue
    const rename = early.names.get(n.id)
    const wantsRename = rename !== undefined && rename !== n.name
    const wantsMove = early.parents.has(n.id) && early.parents.get(n.id) !== n.parentId
    if (!wantsRename && !wantsMove) continue
    let parent = n.parentId
    let why: string | null = null
    if (wantsMove) {
      const to = early.parents.get(n.id)!
      if (to === null ? folderId !== null : !map.has(to)) why = "Its old folder is gone or outside this folder"
      else if (to !== null && map.get(to)!.trashedAt !== null) why = "Its old folder is in the Trash"
      else {
        for (let c: string | null = to; c; c = map.get(c)?.parentId ?? null)
          if (c === n.id) why = "It would go inside itself"
        if (!why) parent = to
      }
      if (why) blocked.push(item(n, why))
    }
    const moved = parent !== n.parentId
    if (!moved && !wantsRename) continue
    const want = wantsRename ? rename! : n.name
    const name = await fit(n, parent, want)
    const taken = name !== want ? ` (“${want}” is taken)` : ""
    if (wantsRename) renames.push(item(n, `to “${name}”${taken}`))
    if (moved) moves.push(item(n, `to ${nameOf(parent)}${wantsRename ? "" : taken}`))
    await place(n, parent, name)
    edits.push({ n: { ...n }, parentId: parent, name, moved })
    n.parentId = parent
    n.name = name
  }
  const untracked = [...early.untracked].filter((id) => map.has(id)).length
  return {
    trash,
    versions,
    edits,
    preview: {
      at: at.toISOString(),
      trash: trash.map((x) => item(x.n, x.name && `as “${x.name}” because that name is taken`)),
      versions: versions.map((v) => item(v.n, `back to version ${v.number}`)),
      renames,
      moves,
      blocked,
      untracked,
    } satisfies RestorePreview,
  }
}

export async function previewRestore(
  me: Me,
  folderId: string | null,
  at: Date
): Promise<RestorePreview & { error?: string }> {
  const bad = await scopeOf(me, folderId, at)
  if (bad) return { error: bad } as RestorePreview & { error: string }
  return (await plan(me, folderId, at)).preview
}

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`

export async function applyRestore(me: Me, folderId: string | null, at: Date): Promise<Applied> {
  const bad = await scopeOf(me, folderId, at)
  if (bad) return { error: bad } as Applied
  const p = await plan(me, folderId, at)
  const undo: PointRestoreUndo[] = []
  const blocked = [...p.preview.blocked]
  const done = { trash: [] as RestoreItem[], versions: [] as RestoreItem[], renames: [] as RestoreItem[], moves: [] as RestoreItem[] }
  const asItem = (n: { id: string; name: string; kind: "file" | "folder" }, detail: string | null = null) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    detail,
  })

  // The tree is read fresh for each item; one transaction each so a clash holds back only itself.
  for (const { n, name } of p.trash) {
    try {
      const ok = await db.transaction(async (tx) => {
        if (name) await tx.update(nodes).set({ name }).where(eq(nodes.id, n.id))
        return restoreNode(tx, me.id, n.id)
      })
      if (!ok) continue
      if (name) undo.push({ kind: "name", nodeId: n.id, name: n.name })
      undo.push({ kind: "retrash", nodeId: n.id })
      done.trash.push(asItem(n, name && `as “${name}”`))
    } catch (e) {
      if (!isClash(e)) throw e
      blocked.push(asItem(n, "Something with that name is already there"))
    }
  }

  for (const v of p.versions) {
    const old = v.n.currentVersionId!
    const r = await makeCurrent(me, v.to)
    if (r.error) blocked.push(asItem(v.n, r.error))
    else {
      undo.push({ kind: "version", nodeId: v.n.id, versionId: old })
      done.versions.push(asItem(v.n, `back to version ${v.number}`))
    }
  }

  for (const e of p.edits) {
    try {
      const ok = await db.transaction(async (tx) => {
        if (e.moved && e.parentId) {
          const [row] = await tx.execute<{ bad: boolean }>(sql`
            with recursive up as (
              select id, parent_id from nodes where id = ${e.parentId}
              union all
              select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
            )
            select exists(select 1 from up where id = ${e.n.id}) or not exists(
              select 1 from nodes where id = ${e.parentId} and trashed_at is null) as bad`)
          if (row?.bad) return false
        }
        const r = await tx
          .update(nodes)
          .set({ parentId: e.parentId, name: e.name, updatedAt: new Date() })
          .where(and(eq(nodes.id, e.n.id), eq(nodes.ownerId, me.id), isNull(nodes.trashedAt)))
          .returning({ id: nodes.id })
        return r.length > 0
      })
      if (!ok) {
        blocked.push(asItem(e.n, "It changed while restoring"))
        continue
      }
      undo.push(
        e.moved
          ? { kind: "parent", nodeId: e.n.id, parentId: e.n.parentId, name: e.n.name }
          : { kind: "name", nodeId: e.n.id, name: e.n.name }
      )
      if (e.name !== e.n.name) done.renames.push(asItem(e.n, `to “${e.name}”`))
      if (e.moved) done.moves.push(asItem(e.n, "moved back"))
    } catch (err) {
      if (!isClash(err)) throw err
      blocked.push(asItem(e.n, "Something with that name is already there"))
    }
  }

  let id: string | undefined
  if (undo.length) {
    const [row] = await db
      .insert(pointRestores)
      .values({ ownerId: me.id, folderId, at, undo })
      .returning({ id: pointRestores.id })
    id = row.id
    if (folderId)
      await record([
        {
          nodeId: folderId,
          actorId: me.id,
          type: "restore",
          detail: `Restored to ${when(at)}`,
          restoreId: id,
        },
      ])
  }
  return { at: at.toISOString(), id, ...done, blocked }
}

// Puts back what one restore changed, newest change first. Anything that can't go back
// (a name taken since, a version deleted) is counted, not forced.
export async function undoRestore(
  me: Me,
  restoreId: string
): Promise<{ error?: string; undone?: number; skipped?: number }> {
  if (!UUID.test(restoreId)) return { error: GONE }
  const [r] = await db.select().from(pointRestores).where(eq(pointRestores.id, restoreId))
  if (!r) return { error: GONE }
  if (r.ownerId !== me.id) return { error: NOT_ALLOWED }
  if (r.undoneAt) return { error: "That restore was already undone." }
  if (!undoable(r.createdAt.getTime(), r.undoneAt)) return { error: "Restores can only be undone for 7 days." }
  let undone = 0
  let skipped = 0
  for (const op of [...r.undo].reverse()) {
    try {
      if (op.kind === "retrash") await trashNodes(db, me.id, [op.nodeId])
      else if (op.kind === "version") {
        const res = await makeCurrent(me, op.versionId)
        if (res.error) throw new Error(res.error)
      } else
        await db
          .update(nodes)
          .set({
            name: op.name,
            ...(op.kind === "parent" ? { parentId: op.parentId } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(nodes.id, op.nodeId), eq(nodes.ownerId, me.id), isNull(nodes.trashedAt)))
      undone++
    } catch {
      skipped++
    }
  }
  await db.update(pointRestores).set({ undoneAt: new Date() }).where(eq(pointRestores.id, restoreId))
  return { undone, skipped }
}
