// Server Backup jobs: what to back up on a server, where the restic repository lives, when, and how long to keep it.
// Every function takes the member's id and only touches that member's rows.
import "server-only"

import { randomBytes } from "node:crypto"

import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { and, count, desc, eq, sql, sum } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { removeKeys } from "@/lib/backup/dest"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { serverBackupHosts, serverBackupJobs, serverBackupRuns, serverBackupSnapshots } from "@/lib/db/schema"
import { open } from "@/lib/gitbackup/dest"
import { prepareDest, releaseKey, type DestInput } from "@/lib/gitbackup/setup"
import { getSettings } from "@/lib/signup"
import { dockerSocket } from "./exec"
import { ownedHost } from "./hosts"
import { DEFAULT_RETENTION, lines, pathError, retentionOk, VOLUME_RE, type Retention } from "./rules"
import * as runner from "./runner"

type Job = typeof serverBackupJobs.$inferSelect

export const MAX_INTERVAL = 525_600

export type JobView = {
  id: string
  name: string
  hostId: string
  hostLabel: string
  hostMode: "ssh" | "agent"
  isSelf: boolean
  paths: string[]
  excludes: string[]
  volumes: string[]
  stopContainers: boolean
  preHook: string
  postHook: string
  destKind: "nimbus" | "s3"
  bucket: string
  endpoint: string
  accessKey: string
  region: string
  pathStyle: boolean
  prefix: string
  retention: Retention
  intervalMin: number
  paused: boolean
  failStreak: number
  lastRunAt: string | null
  lastStatus: "ok" | "failed" | null
  lastError: string | null
  nextDueAt: string
  createdAt: string
  snapshots: number
  stored: number
}

export type RunView = {
  id: string
  trigger: "schedule" | "manual" | "first" | "agent"
  status: "running" | "ok" | "failed"
  progress: number | null
  stage: string
  bytes: number
  files: number
  snapshotId: string | null
  error: string | null
  logTail: string
  startedAt: string
  finishedAt: string | null
}

export type SnapshotView = { id: string; resticId: string; takenAt: string; source: string; kind: "tar" | "files"; bytes: number | null; addedBytes: number | null }

export type NewJob = {
  name: string
  hostId: string
  paths: string
  excludes: string
  volumes: string[]
  stopContainers: boolean
  preHook: string
  postHook: string
  prefix?: string
  intervalMin: number
  retention: Retention
  dest: DestInput
}
export type JobEdit = Omit<NewJob, "hostId" | "dest" | "prefix"> & { dest?: DestInput }

const iso = (d: Date | null) => d?.toISOString() ?? null
const UUID = /^[0-9a-f-]{36}$/i

export async function ownedJob(userId: string, id: string): Promise<Job | null> {
  if (!UUID.test(id)) return null
  const [j] = await db.select().from(serverBackupJobs).where(and(eq(serverBackupJobs.id, id), eq(serverBackupJobs.userId, userId)))
  return j ?? null
}

// ---- reading -----------------------------------------------------------------------------------------------------

async function view(j: Job): Promise<JobView> {
  const [h] = await db.select().from(serverBackupHosts).where(eq(serverBackupHosts.id, j.hostId))
  const [s] = await db.select({ n: count(), stored: sum(serverBackupSnapshots.addedBytes) }).from(serverBackupSnapshots).where(eq(serverBackupSnapshots.jobId, j.id))
  const [last] = await db.select({ error: serverBackupRuns.error }).from(serverBackupRuns).where(and(eq(serverBackupRuns.jobId, j.id), eq(serverBackupRuns.status, "failed"))).orderBy(desc(serverBackupRuns.startedAt)).limit(1)
  return {
    id: j.id, name: j.name, hostId: j.hostId, hostLabel: h?.label ?? "Missing", hostMode: h?.mode ?? "ssh", isSelf: h?.isSelf ?? false,
    paths: j.paths, excludes: j.excludes, volumes: j.volumes, stopContainers: j.stopContainers, preHook: j.preHook, postHook: j.postHook,
    destKind: j.destKind, bucket: j.s3Bucket ?? "", endpoint: j.s3Endpoint ?? "", accessKey: j.s3AccessKey ?? "", region: j.s3Region ?? "", pathStyle: j.s3PathStyle,
    prefix: j.prefix, retention: j.retention, intervalMin: j.intervalMin, paused: j.paused, failStreak: j.failStreak, lastRunAt: iso(j.lastRunAt),
    lastStatus: j.lastStatus, lastError: j.lastStatus === "failed" ? (last?.error ?? null) : null, nextDueAt: j.nextDueAt.toISOString(), createdAt: j.createdAt.toISOString(),
    snapshots: s.n, stored: Number(s.stored ?? 0),
  }
}

export async function listJobs(userId: string): Promise<JobView[]> {
  const rows = await db.select().from(serverBackupJobs).where(eq(serverBackupJobs.userId, userId)).orderBy(serverBackupJobs.createdAt)
  return Promise.all(rows.map(view))
}

export async function listRuns(userId: string, jobId: string, limit = 30): Promise<RunView[]> {
  if (!(await ownedJob(userId, jobId))) return []
  const rows = await db.select().from(serverBackupRuns).where(eq(serverBackupRuns.jobId, jobId)).orderBy(desc(serverBackupRuns.startedAt)).limit(limit)
  return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt) }))
}

export async function listSnapshots(userId: string, jobId: string): Promise<SnapshotView[]> {
  if (!(await ownedJob(userId, jobId))) return []
  const rows = await db.select().from(serverBackupSnapshots).where(eq(serverBackupSnapshots.jobId, jobId)).orderBy(desc(serverBackupSnapshots.takenAt)).limit(500)
  return rows.map((s) => ({ id: s.id, resticId: s.resticId, takenAt: s.takenAt.toISOString(), source: s.source, kind: s.kind, bytes: s.bytes, addedBytes: s.addedBytes }))
}

// The run in progress, for the live bar; null when idle.
export async function activeRun(userId: string, jobId: string): Promise<RunView | null> {
  if (!(await ownedJob(userId, jobId))) return null
  const [r] = await db.select().from(serverBackupRuns).where(and(eq(serverBackupRuns.jobId, jobId), eq(serverBackupRuns.status, "running")))
  return r ? { ...r, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt) } : null
}

// ---- checks ------------------------------------------------------------------------------------------------------

async function check(v: JobEdit, host: { isSelf: boolean; mode: "ssh" | "agent" }, admin: boolean): Promise<{ error: string } | { value: Pick<Job, "name" | "paths" | "excludes" | "volumes" | "stopContainers" | "preHook" | "postHook" | "intervalMin" | "retention"> }> {
  const name = String(v.name ?? "").trim().replace(/\s+/g, " ")
  if (!name || name.length > 60) return { error: "Give the job a name of up to 60 characters." }
  const paths = lines(String(v.paths ?? ""))
  const excludes = lines(String(v.excludes ?? ""))
  for (const p of paths) {
    const bad = pathError(p)
    if (bad) return { error: bad }
  }
  if (paths.length > 200 || excludes.length > 200 || excludes.some((e) => e.length > 500 || /[\0\n\r]/.test(e))) return { error: "That is too many paths or patterns." }
  const volumes = [...new Set((v.volumes ?? []).map(String))]
  if (volumes.some((x) => !VOLUME_RE.test(x))) return { error: "A Docker volume name isn't valid." }
  const preHook = String(v.preHook ?? "").trim()
  const postHook = String(v.postHook ?? "").trim()
  if (preHook.length > 4000 || postHook.length > 4000) return { error: "A command can be up to 4000 characters." }
  if (host.isSelf) {
    if (!admin) return { error: "Only an admin can back up this server." }
    if (paths.length || preHook || postHook) return { error: "For this Nimbus server only Docker volumes can be backed up, without commands." }
  }
  if (host.mode === "agent" && volumes.length) return { error: "A push agent backs up the paths you give it, not Docker volumes." }
  if (!paths.length && !volumes.length) return { error: host.isSelf ? "Pick at least one Docker volume." : "Add at least one folder or Docker volume." }
  if (v.stopContainers && !volumes.length) return { error: "Stopping containers applies to Docker volumes. Pick a volume or turn it off." }
  const min = (await getSettings()).serverBackupMinInterval
  if (!Number.isInteger(v.intervalMin) || v.intervalMin > MAX_INTERVAL) return { error: "Back up every: enter a whole number of minutes." }
  if (v.intervalMin < min) return { error: `Back up every: the shortest allowed is ${min} minutes.` }
  if (!retentionOk(v.retention)) return { error: "Keep at least one daily, weekly or monthly snapshot, each between 0 and 1000." }
  return { value: { name, paths, excludes, volumes, stopContainers: Boolean(v.stopContainers), preHook, postHook, intervalMin: v.intervalMin, retention: { daily: v.retention.daily, weekly: v.retention.weekly, monthly: v.retention.monthly } } }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job"

// ---- changing ----------------------------------------------------------------------------------------------------

// The repository password is made here and comes back once; only its sealed form is kept.
export async function createJob(userId: string, admin: boolean, v: NewJob): Promise<{ id?: string; password?: string; error?: string }> {
  const host = await ownedHost(userId, v.hostId)
  if (!host) return { error: "Pick a server first." }
  const c = await check(v, host, admin)
  if ("error" in c) return c
  if (host.mode === "ssh" && !host.isSelf && !host.hostKey) return { error: "Test the connection to this server first, so Nimbus can record its host key." }
  const [dup] = await db.select({ id: serverBackupJobs.id }).from(serverBackupJobs).where(and(eq(serverBackupJobs.userId, userId), sql`lower(${serverBackupJobs.name}) = ${c.value.name.toLowerCase()}`))
  if (dup) return { error: `You already have a job called “${c.value.name}”.` }
  const dest = await prepareDest(userId, c.value.name, v.dest, "Server Backup")
  if ("error" in dest) return dest
  const password = randomBytes(32).toString("base64url")
  try {
    const [job] = await db
      .insert(serverBackupJobs)
      .values({ userId, hostId: host.id, ...c.value, ...dest.fields, prefix: `server-backup/${slug(c.value.name)}`, resticPasswordEnc: encrypt(password) })
      .returning({ id: serverBackupJobs.id })
    await audit("server_backup_job_create", { detail: `${c.value.name} on ${host.label}` })
    // The first backup starts at once (an agent's runs start on the server); a worker that isn't up only means it waits for the schedule.
    if (host.mode === "ssh") await runner.requestRun(userId, job.id, "first").catch(() => {})
    return { id: job.id, password }
  } catch (e) {
    await releaseKey(userId, dest.fields.keyId ?? null)
    throw e
  }
}

export async function updateJob(userId: string, admin: boolean, id: string, v: JobEdit): Promise<{ error?: string }> {
  const j = await ownedJob(userId, id)
  if (!j) return { error: "That job isn't here." }
  const host = await ownedHost(userId, j.hostId)
  if (!host) return { error: "That server isn't here." }
  const c = await check(v, host, admin)
  if ("error" in c) return c
  const [dup] = await db.select({ id: serverBackupJobs.id }).from(serverBackupJobs).where(and(eq(serverBackupJobs.userId, userId), sql`lower(${serverBackupJobs.name}) = ${c.value.name.toLowerCase()}`))
  if (dup && dup.id !== id) return { error: `You already have a job called “${c.value.name}”.` }
  const set: Partial<typeof serverBackupJobs.$inferInsert> = { ...c.value }
  let oldKey: string | null = null
  if (v.dest) {
    const d = v.dest.kind === "s3" && !v.dest.secret && j.destKind === "s3" && j.s3SecretEnc ? { ...v.dest, secret: decrypt(j.s3SecretEnc) ?? "" } : v.dest
    const dest = await prepareDest(userId, c.value.name, d, "Server Backup")
    if ("error" in dest) return dest
    Object.assign(set, dest.fields)
    oldKey = j.keyId
    // A new place is a new repository: the old snapshots stay where they were, but this job no longer lists them.
    set.prefix = `server-backup/${slug(c.value.name)}`
    await db.delete(serverBackupSnapshots).where(eq(serverBackupSnapshots.jobId, id))
  }
  await db.update(serverBackupJobs).set(set).where(eq(serverBackupJobs.id, id))
  await releaseKey(userId, oldKey)
  await audit("server_backup_job_update", { detail: c.value.name })
  return {}
}

export async function setPaused(userId: string, id: string, paused: boolean): Promise<{ error?: string }> {
  const j = await ownedJob(userId, id)
  if (!j) return { error: "That job isn't here." }
  await db.update(serverBackupJobs).set({ paused }).where(eq(serverBackupJobs.id, id))
  await audit(paused ? "server_backup_job_pause" : "server_backup_job_resume", { detail: j.name })
  return {}
}

export async function backupNow(userId: string, id: string): Promise<{ error?: string }> {
  const j = await ownedJob(userId, id)
  if (!j) return { error: "That job isn't here." }
  const host = await ownedHost(userId, j.hostId)
  if (host?.mode === "agent") return { error: "This job runs on the server itself. Run nimbus-agent.sh there." }
  try {
    const r = await runner.requestRun(userId, id, "manual")
    return r.started ? {} : { error: "A backup is already running." }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Every object under the job's folder in the bucket.
async function purgeRepo(j: Job) {
  const d = open(j)
  try {
    let token: string | undefined
    do {
      const r = await d.s3.send(new ListObjectsV2Command({ Bucket: d.bucket, Prefix: `${j.prefix}/`, ContinuationToken: token }))
      const keys = (r.Contents ?? []).map((o) => o.Key!).filter(Boolean)
      if (keys.length) await removeKeys(d.s3, d.bucket, keys)
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token)
  } finally {
    d.s3.destroy()
  }
}

// purge: also delete the repository (every snapshot) from the bucket; without it the data stays but the password is lost with the job.
export async function deleteJob(userId: string, id: string, purge: boolean): Promise<{ error?: string }> {
  const j = await ownedJob(userId, id)
  if (!j) return {}
  if (purge) {
    try {
      await purgeRepo(j)
    } catch (e) {
      return { error: `Couldn't delete the stored backups: ${(e as Error).message}. The job is kept.` }
    }
  }
  await db.delete(serverBackupJobs).where(eq(serverBackupJobs.id, id))
  await releaseKey(userId, j.keyId)
  await audit("server_backup_job_delete", { detail: `${j.name}${purge ? " (and backups)" : ""}` })
  return {}
}

// What the wizard says about this server's Docker socket.
export const selfDocker = dockerSocket
export { DEFAULT_RETENTION }
