// Media Converter: the member's queue, presets and watch folders. Every function takes the member's id and only touches their rows.
// The worker (scripts/convert.ts) runs the jobs; lib/convert/store.ts saves what it made.
import "server-only"

import { and, desc, eq, gte, ilike, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { convertJobs, convertPresets, convertWatches, fileVersions, nodes } from "@/lib/db/schema"
import { AUDIO, formatBytes, IMAGE, VIDEO } from "@/lib/file-rules"
import { enqueueConvert } from "@/lib/redis"
import { getSettings } from "@/lib/signup"
import { BUILTIN, cleanPreset, HEIC, inKind, takes, type InKind, type Preset } from "./rules.ts"

export type JobView = {
  id: string
  status: "queued" | "running" | "done" | "failed" | "cancelled"
  progress: number
  etaSec: number | null
  inputName: string
  outputName: string | null
  outputNodeId: string | null
  presetName: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}
export type PresetView = { id: string; name: string; text: string; preset: Preset; own: boolean }
export type WatchView = { id: string; folderId: string; path: string; presetName: string; preset: Preset }
export type Media = { id: string; name: string; size: number; kind: InKind }

const view = (j: typeof convertJobs.$inferSelect): JobView => ({
  id: j.id,
  status: j.status,
  progress: j.progress,
  etaSec: j.etaSec,
  inputName: j.inputName,
  outputName: j.outputName,
  outputNodeId: j.outputNodeId,
  presetName: j.presetName,
  error: j.error,
  createdAt: j.createdAt.toISOString(),
  finishedAt: j.finishedAt?.toISOString() ?? null,
})

export async function listJobs(userId: string): Promise<JobView[]> {
  const rows = await db
    .select()
    .from(convertJobs)
    .where(eq(convertJobs.userId, userId))
    .orderBy(sql`(${convertJobs.status} in ('queued', 'running')) desc`, desc(convertJobs.createdAt))
    .limit(60)
  return rows.map(view)
}

export async function listPresets(userId: string): Promise<PresetView[]> {
  const own = await db.select().from(convertPresets).where(eq(convertPresets.userId, userId)).orderBy(convertPresets.name)
  return [
    ...BUILTIN.map((b) => ({ id: b.id, name: b.name, text: b.text, preset: b.preset, own: false })),
    ...own.map((p) => ({ id: p.id, name: p.name, text: "", preset: p.preset, own: true })),
  ]
}

// A built-in id or one of the member's own preset ids; `trim` overrides start and end on video and GIF presets.
export async function resolvePreset(userId: string, ref: string, trim?: { start?: number; end?: number }) {
  const hit = (await listPresets(userId)).find((p) => p.id === ref)
  if (!hit) return null
  const preset = trim && (hit.preset.kind === "video" || hit.preset.kind === "gif") ? cleanPreset({ ...hit.preset, ...trim }) : hit.preset
  return preset ? { name: hit.name, preset } : null
}

// Seconds of media the member has converted (or has running) today; the daily quota counts these.
export async function usedSeconds(userId: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${convertJobs.seconds}), 0)::int` })
    .from(convertJobs)
    .where(and(eq(convertJobs.userId, userId), gte(convertJobs.createdAt, sql`date_trunc('day', now())`), inArray(convertJobs.status, ["queued", "running", "done"])))
  return r.n
}

export type Quota = { limitMin: number; usedMin: number } | null
export async function quotaOf(userId: string): Promise<Quota> {
  const { convertDailyMinutes: limitMin } = await getSettings()
  return limitMin > 0 ? { limitMin, usedMin: Math.ceil((await usedSeconds(userId)) / 60) } : null
}

async function queueOne(userId: string, n: { id: string; name: string }, preset: Preset, presetName: string, watchId?: string) {
  const [job] = await db
    .insert(convertJobs)
    .values({ userId, inputNodeId: n.id, inputName: n.name, presetName, preset, watchId })
    .returning({ id: convertJobs.id })
  await enqueueConvert(job.id)
}

export type Queued = { queued: number; skipped: { name: string; why: string }[]; error?: string }

// Queues one job per file. A file that can't be converted is skipped with the reason; the rest go ahead.
export async function createJobs(userId: string, nodeIds: string[], presetRef: string, trim?: { start?: number; end?: number }, watchId?: string): Promise<Queued> {
  const s = await getSettings()
  if (!s.convertToolEnabled) return { queued: 0, skipped: [], error: "The Media Converter is turned off on this server." }
  const p = await resolvePreset(userId, presetRef, trim)
  if (!p) return { queued: 0, skipped: [], error: "That preset isn't valid. Pick another." }
  if (s.convertDailyMinutes > 0 && (await usedSeconds(userId)) >= s.convertDailyMinutes * 60)
    return { queued: 0, skipped: [], error: `You've used your ${s.convertDailyMinutes} minutes of conversion for today. It resets at midnight.` }
  const rows = nodeIds.length
    ? await db
        .select({ id: nodes.id, name: nodes.name, size: nodes.size })
        .from(nodes)
        .leftJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
        .where(and(inArray(nodes.id, nodeIds.slice(0, 200)), eq(nodes.ownerId, userId), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId), isNull(fileVersions.encKey)))
    : []
  const skipped: Queued["skipped"] = []
  let queued = 0
  for (const n of rows) {
    if (!takes(p.preset, inKind(n.name))) skipped.push({ name: n.name, why: `${p.name} doesn't work on this kind of file.` })
    else if (s.convertMaxBytes !== null && n.size > s.convertMaxBytes) skipped.push({ name: n.name, why: `Larger than the ${formatBytes(s.convertMaxBytes)} limit for conversions.` })
    else {
      await queueOne(userId, n, p.preset, p.name, watchId)
      queued++
    }
  }
  for (const id of nodeIds) if (!rows.some((r) => r.id === id)) skipped.push({ name: "A file", why: "It isn't yours, is in the trash, or is in a vault." })
  return { queued, skipped }
}

// Queued or running only. A running one stops within a second: the worker sees the status change.
export async function cancelJob(userId: string, id: string) {
  await db
    .update(convertJobs)
    .set({ status: "cancelled", etaSec: null, finishedAt: new Date() })
    .where(and(eq(convertJobs.id, id), eq(convertJobs.userId, userId), inArray(convertJobs.status, ["queued", "running"])))
}

export async function clearFinished(userId: string) {
  await db.delete(convertJobs).where(and(eq(convertJobs.userId, userId), inArray(convertJobs.status, ["done", "failed", "cancelled"])))
}

// ---- presets ----
export async function savePreset(userId: string, v: { id?: string; name: string; preset: unknown }): Promise<{ error?: string }> {
  const name = String(v.name ?? "").trim().slice(0, 40)
  const preset = cleanPreset(v.preset)
  if (!name) return { error: "Give the preset a name." }
  if (!preset) return { error: "Those settings don't work together. Check the trim times." }
  if (BUILTIN.some((b) => b.name.toLowerCase() === name.toLowerCase() || b.id === name.toLowerCase())) return { error: "A built-in preset has that name." }
  try {
    if (v.id) await db.update(convertPresets).set({ name, preset }).where(and(eq(convertPresets.id, v.id), eq(convertPresets.userId, userId)))
    else await db.insert(convertPresets).values({ userId, name, preset })
  } catch {
    return { error: "You already have a preset with that name." }
  }
  return {}
}

export async function deletePreset(userId: string, id: string) {
  await db.delete(convertPresets).where(and(eq(convertPresets.id, id), eq(convertPresets.userId, userId)))
}

// ---- watch folders ----
export async function listWatches(userId: string): Promise<WatchView[]> {
  const rows = await db.execute<{ id: string; folderId: string; path: string; presetName: string; preset: Preset }>(sql`
    with recursive up as (
      select w.id as wid, n.id, n.parent_id, n.name, 0 as depth from convert_watches w join nodes n on n.id = w.folder_node_id where w.user_id = ${userId}
      union all
      select up.wid, n.id, n.parent_id, n.name, up.depth + 1 from nodes n join up on n.id = up.parent_id
    )
    select w.id, w.folder_node_id as "folderId", w.preset_name as "presetName", w.preset,
      '/' || (select string_agg(name, '/' order by depth desc) from up where wid = w.id) as path
    from convert_watches w where w.user_id = ${userId} order by w.created_at`)
  return [...rows]
}

export async function addWatch(userId: string, folderId: string, presetRef: string): Promise<{ error?: string }> {
  const p = await resolvePreset(userId, presetRef)
  if (!p) return { error: "That preset isn't valid. Pick another." }
  const [f] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.id, folderId), eq(nodes.ownerId, userId), eq(nodes.kind, "folder"), isNull(nodes.trashedAt), isNull(nodes.vaultId)))
  if (!f) return { error: "Pick one of your own folders." }
  try {
    await db.insert(convertWatches).values({ userId, folderNodeId: folderId, presetName: p.name, preset: p.preset })
  } catch {
    return { error: "That folder is already watched with this preset." }
  }
  return {}
}

export async function removeWatch(userId: string, id: string) {
  await db.delete(convertWatches).where(and(eq(convertWatches.id, id), eq(convertWatches.userId, userId)))
}

// After a file lands in a folder (lib/uploads.ts, lib/store-file.ts): queue it for every preset watching that folder.
// Converter outputs never come through here (lib/convert/store.ts saves them itself), so a watch can't feed on its own results.
// ponytail: a file is converted once per watch, even if a later version replaces it; a version column would allow re-runs.
export async function watchHook(nodeId: string) {
  const [n] = await db
    .select({ ownerId: nodes.ownerId, parentId: nodes.parentId, name: nodes.name })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.kind, "file"), isNull(nodes.vaultId)))
  if (!n?.parentId || !inKind(n.name)) return
  const watches = await db
    .select()
    .from(convertWatches)
    .where(and(eq(convertWatches.folderNodeId, n.parentId), eq(convertWatches.userId, n.ownerId)))
  if (!watches.length || !(await getSettings()).convertToolEnabled) return
  for (const w of watches) {
    if (!takes(w.preset, inKind(n.name))) continue
    const [seen] = await db
      .select({ id: convertJobs.id })
      .from(convertJobs)
      .where(and(eq(convertJobs.inputNodeId, nodeId), eq(convertJobs.watchId, w.id)))
      .limit(1)
    if (seen) continue
    // A watch keeps its own copy of the preset, so a later edit of a saved preset doesn't change it.
    const s = await getSettings()
    const [size] = await db.select({ n: nodes.size }).from(nodes).where(eq(nodes.id, nodeId))
    if ((s.convertDailyMinutes > 0 && (await usedSeconds(n.ownerId)) >= s.convertDailyMinutes * 60) || (s.convertMaxBytes !== null && size.n > s.convertMaxBytes)) continue
    await queueOne(n.ownerId, { id: nodeId, name: n.name }, w.preset, w.presetName, w.id)
  }
}

// ---- the file picker ----
const MEDIA = new RegExp([VIDEO, AUDIO, IMAGE, HEIC].map((r) => r.source.replace(/^\\\.\(|\)\$$/g, "")).join("|"))
const MEDIA_SQL = `\\.(${MEDIA.source})$`

export async function findMedia(userId: string, q: string): Promise<Media[]> {
  const term = q.trim().replace(/[%_\\]/g, "\\$&")
  const rows = await db
    .select({ id: nodes.id, name: nodes.name, size: nodes.size })
    .from(nodes)
    .where(and(eq(nodes.ownerId, userId), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId), sql`${nodes.name} ~* ${MEDIA_SQL}`, term ? ilike(nodes.name, `%${term}%`) : undefined))
    .orderBy(desc(nodes.updatedAt))
    .limit(40)
  return rows.flatMap((r) => {
    const kind = inKind(r.name)
    return kind ? [{ ...r, kind }] : []
  })
}

// The More card's line: what is converting now, or the last result.
export async function convertStatus(userId: string): Promise<{ text: string; failing?: boolean }> {
  const [r] = await db
    .select({
      active: sql<number>`count(*) filter (where ${convertJobs.status} in ('queued', 'running'))`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${convertJobs.status} = 'done' and ${convertJobs.finishedAt} > now() - interval '7 days')`.mapWith(Number),
      lastFailed: sql<boolean>`(select j.status = 'failed' from convert_jobs j where j.user_id = ${userId} and j.status in ('done', 'failed') order by j.finished_at desc limit 1)`.mapWith(Boolean),
    })
    .from(convertJobs)
    .where(eq(convertJobs.userId, userId))
  const text = r.active ? `${r.active} converting` : r.done ? `${r.done} converted this week` : "Nothing converted yet"
  return { text, failing: r.lastFailed }
}
