// Cloud Import jobs: create, edit, pause, delete, and what the tabs show (runs, items). Every function takes the member's id and
// only touches that member's rows. runner.ts does the work; the worker starts runs through /api/jobs.
import "server-only"

import { and, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { importConnections, importItems, importJobs, importRuns, nodes } from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { getSettings } from "@/lib/signup"
import { ownConnection } from "./connections.ts"
import { cleanOptions, MAX_INTERVAL, MIN_INTERVAL, PAGE, type ImportOptions, type Provider } from "./rules.ts"
import { control, progressOf, startRun, type Progress } from "./runner.ts"

type Job = typeof importJobs.$inferSelect

export type JobView = {
  id: string
  name: string
  kind: "rclone" | "takeout"
  connection: { id: string; label: string; provider: Provider } | null
  sources: string[]
  // Takeout: the zips' names, in the order of `sources`.
  zipNames: string[]
  target: { id: string; path: string } | null
  options: ImportOptions
  intervalMin: number | null
  paused: boolean
  failStreak: number
  lastRunAt: string | null
  lastStatus: Job["lastStatus"]
  nextDueAt: string | null
  createdAt: string
  imported: number
  bytes: number
}

export type RunView = {
  id: string
  trigger: "first" | "manual" | "schedule"
  status: "running" | "ok" | "partial" | "failed" | "cancelled"
  filesTotal: number
  filesDone: number
  filesSkipped: number
  filesFailed: number
  bytesDone: number
  errors: string[]
  startedAt: string
  finishedAt: string | null
}

export type ItemView = { id: string; sourcePath: string; nodeId: string | null; size: number; mtime: string | null; status: "imported" | "skipped" | "failed"; error: string | null; updatedAt: string }
export type ItemsPage = { items: ItemView[]; total: number }
export type ZipPick = { id: string; name: string; size: number; where: string }

const iso = (d: Date | null) => d?.toISOString() ?? null

async function owned(userId: string, id: string): Promise<Job | null> {
  if (!UUID.test(id)) return null
  const [j] = await db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)))
  return j ?? null
}

// "/Photos/Takeout" for each folder id.
export async function folderPaths(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db.execute<{ id: string; path: string }>(sql`
    with recursive up as (
      select id as start, id, parent_id, name, 0 as depth from nodes where id in ${ids}
      union all
      select up.start, n.id, n.parent_id, n.name, up.depth + 1 from nodes n join up on n.id = up.parent_id
    )
    select start as id, '/' || string_agg(name, '/' order by depth desc) as path from up group by start`)
  return new Map(rows.map((r) => [r.id, r.path]))
}

async function ownFolder(userId: string, id: unknown) {
  if (typeof id !== "string" || !UUID.test(id)) return null
  const [f] = await db.select({ id: nodes.id }).from(nodes).where(and(eq(nodes.id, id), eq(nodes.ownerId, userId), eq(nodes.kind, "folder"), isNull(nodes.trashedAt), isNull(nodes.vaultId)))
  return f?.id ?? null
}

// ---- reading ----

export async function listJobs(userId: string): Promise<JobView[]> {
  const rows = await db
    .select({
      j: importJobs,
      conn: { id: importConnections.id, label: importConnections.label, provider: importConnections.provider },
      imported: sql<number>`(select count(*) from ${importItems} i where i.job_id = ${importJobs.id} and i.status = 'imported')`.mapWith(Number),
      bytes: sql<number>`(select coalesce(sum(i.size), 0) from ${importItems} i where i.job_id = ${importJobs.id} and i.status = 'imported')`.mapWith(Number),
    })
    .from(importJobs)
    .leftJoin(importConnections, eq(importConnections.id, importJobs.connectionId))
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt))
  const paths = await folderPaths(rows.flatMap((r) => (r.j.targetNodeId ? [r.j.targetNodeId] : [])))
  const zipIds = rows.flatMap((r) => (r.j.kind === "takeout" ? r.j.sources : []))
  const zips = zipIds.length ? new Map((await db.select({ id: nodes.id, name: nodes.name }).from(nodes).where(inArray(nodes.id, zipIds))).map((z) => [z.id, z.name])) : new Map<string, string>()
  return rows.map(({ j, conn, imported, bytes }) => ({
    id: j.id,
    name: j.name,
    kind: j.kind,
    connection: conn?.id ? conn : null,
    sources: j.sources,
    zipNames: j.kind === "takeout" ? j.sources.map((s) => zips.get(s) ?? "A deleted zip") : [],
    target: j.targetNodeId ? { id: j.targetNodeId, path: paths.get(j.targetNodeId) ?? "/" } : null,
    options: cleanOptions(j.options),
    intervalMin: j.intervalMin,
    paused: j.paused,
    failStreak: j.failStreak,
    lastRunAt: iso(j.lastRunAt),
    lastStatus: j.lastStatus,
    nextDueAt: iso(j.nextDueAt),
    createdAt: j.createdAt.toISOString(),
    imported,
    bytes,
  }))
}

export async function listRuns(userId: string, jobId: string): Promise<RunView[]> {
  if (!(await owned(userId, jobId))) return []
  const rows = await db.select().from(importRuns).where(eq(importRuns.jobId, jobId)).orderBy(desc(importRuns.startedAt)).limit(50)
  return rows.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, filesTotal: r.filesTotal, filesDone: r.filesDone, filesSkipped: r.filesSkipped, filesFailed: r.filesFailed, bytesDone: r.bytesDone, errors: r.errors, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt) }))
}

export async function listItems(userId: string, jobId: string, o: { status?: string; q?: string; page?: number }): Promise<ItemsPage> {
  if (!(await owned(userId, jobId))) return { items: [], total: 0 }
  const term = (o.q ?? "").trim().replace(/[%_\\]/g, "\\$&")
  const where = and(eq(importItems.jobId, jobId), o.status === "imported" || o.status === "skipped" || o.status === "failed" ? eq(importItems.status, o.status) : undefined, term ? ilike(importItems.sourcePath, `%${term}%`) : undefined)
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(importItems).where(where),
    db.select().from(importItems).where(where).orderBy(desc(importItems.updatedAt)).limit(PAGE).offset(Math.max(0, Math.floor(o.page ?? 0)) * PAGE),
  ])
  return { total, items: rows.map((i) => ({ id: i.id, sourcePath: i.sourcePath, nodeId: i.nodeId, size: i.size, mtime: iso(i.mtime), status: i.status, error: i.error, updatedAt: i.updatedAt.toISOString() })) }
}

// The member's zip files, for "Import from Takeout".
export async function findZips(userId: string, q: string): Promise<ZipPick[]> {
  const term = q.trim().replace(/[%_\\]/g, "\\$&")
  const rows = await db
    .select({ id: nodes.id, name: nodes.name, size: nodes.size, parent: nodes.parentId })
    .from(nodes)
    .where(and(eq(nodes.ownerId, userId), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId), ilike(nodes.name, "%.zip"), term ? ilike(nodes.name, `%${term}%`) : undefined))
    .orderBy(desc(nodes.updatedAt))
    .limit(50)
  const paths = await folderPaths([...new Set(rows.flatMap((r) => (r.parent ? [r.parent] : [])))])
  return rows.map((r) => ({ id: r.id, name: r.name, size: r.size, where: r.parent ? (paths.get(r.parent) ?? "/") : "/" }))
}

export async function jobProgress(userId: string, jobId: string): Promise<Progress> {
  return (await owned(userId, jobId)) ? progressOf(jobId) : null
}

// ---- writing ----

export type NewJob = {
  name: string
  kind: "rclone" | "takeout"
  connectionId?: string
  sources: string[]
  targetNodeId: string
  options?: Partial<ImportOptions>
  // null = once.
  intervalMin: number | null
  // What the wizard measured, to size the first progress bar.
  estFiles?: number
  estBytes?: number
}

const whole = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.min(Math.round(Number(n)), 2 ** 52) : null)

// Checks what the member sent and turns it into a row's values, or an error to show.
async function checked(userId: string, v: NewJob): Promise<{ error: string } | { value: Omit<typeof importJobs.$inferInsert, "userId"> }> {
  const name = String(v.name ?? "").trim().replace(/\s+/g, " ")
  if (!name || name.length > 60) return { error: "Give the import a name of up to 60 characters." }
  const kind = v.kind === "takeout" ? "takeout" : "rclone"
  const sources = Array.isArray(v.sources) ? v.sources.map((s) => String(s)) : []
  if (kind === "rclone") {
    if (!sources.length) return { error: "Tick at least one folder to bring over." }
    if (sources.length > 200 || sources.some((s) => s.length > 1000 || /\0/.test(s) || s.split("/").some((p) => p === ".."))) return { error: "That list of folders isn't valid." }
  } else if (!sources.length || sources.length > 50 || sources.some((s) => !UUID.test(s))) return { error: "Pick between 1 and 50 Takeout zips." }
  let connectionId: string | null = null
  let provider: string | null = null
  if (kind === "rclone") {
    const c = typeof v.connectionId === "string" ? await ownConnection(userId, v.connectionId) : null
    if (!c) return { error: "Choose a connection." }
    connectionId = c.id
    provider = c.provider
  } else {
    const rows = await db.select({ id: nodes.id }).from(nodes).where(and(inArray(nodes.id, sources), eq(nodes.ownerId, userId), eq(nodes.kind, "file"), isNull(nodes.trashedAt), isNull(nodes.vaultId)))
    if (rows.length !== new Set(sources).size) return { error: "One of the zips isn't yours, or is in the trash or a vault." }
  }
  const target = await ownFolder(userId, v.targetNodeId)
  if (!target) return { error: "Choose one of your own folders to import into." }
  const n = v.intervalMin
  if (n !== null && (!Number.isInteger(n) || n < MIN_INTERVAL || n > MAX_INTERVAL)) return { error: `Pull every ${MIN_INTERVAL} minutes or more.` }
  if (kind === "takeout" && n !== null) return { error: "A Takeout import runs once." }
  const options = cleanOptions(v.options)
  if (provider !== "gdrive") options.sharedWithMe = false
  if (provider !== "gdrive" && kind !== "takeout") {
    options.stars = false
    options.descriptions = false
  }
  return { value: { name, kind, connectionId, sources: [...new Set(sources)], targetNodeId: target, options, intervalMin: n, estFiles: whole(v.estFiles), estBytes: whole(v.estBytes) } }
}

async function enabled() {
  return (await getSettings()).importToolEnabled
}

export async function createJob(userId: string, v: NewJob): Promise<{ id: string } | { error: string }> {
  if (!(await enabled())) return { error: "Cloud import is turned off on this server." }
  const c = await checked(userId, v)
  if ("error" in c) return c
  const [job] = await db
    .insert(importJobs)
    .values({ ...c.value, userId, nextDueAt: c.value.intervalMin ? sql`now() + make_interval(mins => ${c.value.intervalMin})` : null })
    .returning()
  await startRun(job, "first")
  return { id: job.id }
}

// What Settings may change: the name, folders, target, options and schedule. The source connection stays.
export async function updateJob(userId: string, id: string, v: Omit<NewJob, "kind" | "connectionId">): Promise<{ error?: string }> {
  const job = await owned(userId, id)
  if (!job) return { error: "That import is gone." }
  const c = await checked(userId, { ...v, kind: job.kind, connectionId: job.connectionId ?? undefined })
  if ("error" in c) return c
  const value = { name: c.value.name, sources: c.value.sources, targetNodeId: c.value.targetNodeId, options: c.value.options, intervalMin: c.value.intervalMin ?? null }
  await db
    .update(importJobs)
    .set({ ...value, nextDueAt: value.intervalMin ? (job.intervalMin === value.intervalMin && job.nextDueAt ? job.nextDueAt : sql`now() + make_interval(mins => ${value.intervalMin})`) : null })
    .where(eq(importJobs.id, id))
  return {}
}

export async function setPaused(userId: string, id: string, paused: boolean): Promise<{ error?: string }> {
  const job = await owned(userId, id)
  if (!job) return { error: "That import is gone." }
  await db.update(importJobs).set({ paused }).where(eq(importJobs.id, id))
  return {}
}

// "Import now": a run for a job that has none going.
export async function runNow(userId: string, id: string): Promise<{ error?: string }> {
  if (!(await enabled())) return { error: "Cloud import is turned off on this server." }
  const job = await owned(userId, id)
  if (!job) return { error: "That import is gone." }
  const r = await startRun(job, "manual")
  return r.started ? {} : { error: "It's already running." }
}

export async function controlRun(userId: string, id: string, what: "pause" | "resume" | "cancel"): Promise<{ error?: string }> {
  if (!(await owned(userId, id))) return { error: "That import is gone." }
  return (await control(id, what)) ? {} : { error: "Nothing is running." }
}

// Removes the job and its history. What it brought into Files stays.
export async function deleteJob(userId: string, id: string): Promise<{ error?: string }> {
  const job = await owned(userId, id)
  if (!job) return {}
  await control(id, "cancel")
  await db.delete(importJobs).where(eq(importJobs.id, id))
  return {}
}

// The More card's line.
export async function importStatus(userId: string): Promise<{ text: string; failing?: boolean }> {
  const [r] = await db
    .select({
      jobs: count(),
      scheduled: sql<number>`count(*) filter (where ${importJobs.intervalMin} is not null and ${importJobs.paused} = false)`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${importJobs.lastStatus} = 'failed')`.mapWith(Number),
    })
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
  if (!r.jobs) return { text: "Not set up" }
  const [files] = await db.execute<{ n: string }>(sql`select count(*)::text as n from import_items i join import_jobs j on j.id = i.job_id where j.user_id = ${userId} and i.status = 'imported'`)
  const text = `${Number(files?.n ?? 0).toLocaleString("en")} files brought over · ${r.jobs === 1 ? "1 import" : `${r.jobs} imports`}${r.scheduled ? ` · ${r.scheduled} scheduled` : ""}`
  return { text, failing: r.failed > 0 }
}
