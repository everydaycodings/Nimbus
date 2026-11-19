// Git Backup jobs and their repos: create, edit, pause, add and remove repos, runs and snapshots for the History tab.
// Every function takes the member's id and only touches that member's rows.
import "server-only"

import { and, count, desc, eq, min, sql, sum } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { gitBackupConnections, gitBackupJobs, gitBackupRepos, gitBackupRuns, gitBackupSnapshots, registryGitConnections } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { connCfg, type Ref } from "./connections.ts"
import { repoList } from "./hosts.ts"
import { inScope, scopeRule } from "./refs.ts"
import * as runner from "./runner.ts"
import { prepareDest, releaseKey, type DestInput } from "./setup.ts"

type Job = typeof gitBackupJobs.$inferSelect

export const INTERVAL_PRESETS = [15, 60, 360, 720, 1440] as const
export const MAX_INTERVAL = 525_600
export const DEFAULT_PREFIX = "git-backup"
const MAX_PICK = 3000

export type JobView = {
  id: string
  name: string
  connection: { kind: "own" | "registry"; id: string; name: string; account: string | null; expiresAt: string | null }
  destKind: "nimbus" | "s3"
  bucket: string
  endpoint: string
  accessKey: string
  region: string
  pathStyle: boolean
  prefix: string
  intervalMin: number
  keepLast: number
  lfs: boolean
  paused: boolean
  // Owner logins ("*" for everything); newOnly: only their repos made from now on ("Choose repos" plus new ones).
  autoOwners: string[]
  newOnly: boolean
  webhookEnabled: boolean
  failStreak: number
  lastRunAt: string | null
  lastStatus: "ok" | "partial" | "failed" | null
  createdAt: string
  repos: number
  gone: number
  errors: number
  snapshots: number
  bytes: number
  nextDueAt: string | null
}

export type RepoView = {
  id: string
  owner: string
  name: string
  private: boolean
  intervalMin: number | null
  autoAdded: boolean
  status: "pending" | "ok" | "error" | "gone"
  lastError: string | null
  lastCheckedAt: string | null
  lastBackupAt: string | null
  nextDueAt: string
  snapshots: number
  bytes: number
}

export type RunView = {
  id: string
  trigger: "schedule" | "manual" | "webhook" | "first"
  force: boolean
  status: "running" | "ok" | "partial" | "failed"
  checked: number
  changed: number
  failed: number
  bytes: number
  results: (typeof gitBackupRuns.$inferSelect)["results"]
  startedAt: string
  finishedAt: string | null
}

export type SnapshotView = { id: string; key: string; sha: string; refs: number; size: number; lfs: boolean; createdAt: string }

export type Settings = {
  name: string
  prefix: string
  intervalMin: number
  keepLast: number
  lfs: boolean
  autoOwners: string[]
  newOnly?: boolean
}

const iso = (d: Date | null) => d?.toISOString() ?? null

async function owned(userId: string, id: string): Promise<Job | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [j] = await db.select().from(gitBackupJobs).where(and(eq(gitBackupJobs.id, id), eq(gitBackupJobs.userId, userId)))
  return j ?? null
}

async function ownedRepo(userId: string, repoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(repoId)) return null
  const [r] = await db
    .select({ r: gitBackupRepos, job: gitBackupJobs })
    .from(gitBackupRepos)
    .innerJoin(gitBackupJobs, eq(gitBackupJobs.id, gitBackupRepos.jobId))
    .where(and(eq(gitBackupRepos.id, repoId), eq(gitBackupJobs.userId, userId)))
  return r ?? null
}

// ---- checks -----------------------------------------------------------------------------------------------

async function minInterval() {
  return (await getSettings()).gitBackupMinInterval
}

async function intervalError(n: unknown, what = "Back up every"): Promise<string | null> {
  const min = await minInterval()
  if (!Number.isInteger(n) || (n as number) > MAX_INTERVAL) return `${what}: enter a whole number of minutes.`
  return (n as number) < min ? `${what}: the shortest allowed is ${min} minutes.` : null
}

function prefixOf(raw: string): { prefix: string } | { error: string } {
  const p = raw.trim().replace(/^\/+|\/+$/g, "")
  if (!p) return { prefix: DEFAULT_PREFIX }
  return p.length > 200 || /[\0\\]/.test(p) || p.split("/").some((s) => s === "." || s === "..") ? { error: "That folder name isn't valid." } : { prefix: p }
}

// The stored form (refs.ts scopeRule): ["*"], owner logins, or with newOnly "login@<unix seconds>"; an owner that was
// already new-only keeps its time, so saving again doesn't change what counts as new.
function scopeOf(raw: unknown, newOnly: boolean, prev: string[]): string[] | { error: string } {
  const list = (Array.isArray(raw) ? raw : []).map((o) => String(o).trim())
  if (list.includes("*")) return list.length === 1 && !newOnly ? ["*"] : { error: "“Everything” can't be combined with owners." }
  if (list.length > 100 || list.some((o) => o.length > 200 || !/^[\w.-]+(\/[\w.-]+)*$/.test(o) || o.split("/").some((s) => /^\.+$/.test(s)))) return { error: "That list of owners isn't valid." }
  const logins = [...new Map(list.map((o) => [o.toLowerCase(), o])).values()]
  if (!newOnly) return logins
  const now = Math.floor(Date.now() / 1000)
  return logins.map((o) => prev.find((p) => p.includes("@") && scopeRule(p).owner === o.toLowerCase()) ?? `${o}@${now}`)
}

async function checkSettings(s: Settings, prev: string[] = []): Promise<{ error: string } | { value: Omit<Settings, "newOnly"> }> {
  const name = String(s.name ?? "").trim().replace(/\s+/g, " ")
  if (!name || name.length > 60) return { error: "Give the job a name of up to 60 characters." }
  const p = prefixOf(String(s.prefix ?? ""))
  if ("error" in p) return p
  const bad = await intervalError(s.intervalMin)
  if (bad) return { error: bad }
  if (!Number.isInteger(s.keepLast) || s.keepLast < 1 || s.keepLast > 1000) return { error: "Keep between 1 and 1000 snapshots per repo." }
  const autoOwners = scopeOf(s.autoOwners, Boolean(s.newOnly), prev)
  if ("error" in autoOwners) return autoOwners
  return { value: { name, prefix: p.prefix, intervalMin: s.intervalMin, keepLast: s.keepLast, lfs: Boolean(s.lfs), autoOwners } }
}

// "owner/name" strings the token can really see, with the clone URL the host itself reports.
async function pick(userId: string, ref: Ref, names: string[]) {
  if (!Array.isArray(names) || names.length > MAX_PICK || names.some((n) => typeof n !== "string")) return { error: `Pick up to ${MAX_PICK} repos at a time.` }
  const cfg = await connCfg(userId, ref)
  if ("error" in cfg) return cfg
  const list = await repoList(cfg.key, cfg).catch((e: Error) => e)
  if (list instanceof Error) return { error: list.message }
  const by = new Map(list.repos.map((r) => [r.fullName.toLowerCase(), r]))
  const rows = []
  for (const n of new Set(names)) {
    const r = by.get(n.toLowerCase())
    if (!r) return { error: `${n} isn't visible to this token any more. Refresh the list.` }
    rows.push({ owner: r.owner, name: r.name, cloneUrl: r.cloneUrl, private: r.private })
  }
  return { rows, owners: new Set(list.owners.map((o) => o.login.toLowerCase())), all: list.repos }
}

const unreachable = (scope: string[], owners: Set<string>) => scope.some((e) => e !== "*" && !owners.has(scopeRule(e).owner))

// ---- reading ----------------------------------------------------------------------------------------------

async function connectionOf(j: Job): Promise<JobView["connection"]> {
  if (j.connectionId) {
    const [c] = await db.select().from(gitBackupConnections).where(eq(gitBackupConnections.id, j.connectionId))
    return { kind: "own", id: j.connectionId, name: c?.name ?? "Missing", account: c?.account ?? null, expiresAt: iso(c?.expiresAt ?? null) }
  }
  const [c] = await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, j.registryConnectionId!))
  return { kind: "registry", id: j.registryConnectionId!, name: c?.name ?? "Missing", account: c?.account ?? null, expiresAt: iso(c?.expiresAt ?? null) }
}

async function view(j: Job): Promise<JobView> {
  const [agg] = await db
    .select({
      repos: count(),
      gone: sql<number>`count(*) filter (where ${gitBackupRepos.status} = 'gone')::int`,
      errors: sql<number>`count(*) filter (where ${gitBackupRepos.status} = 'error')::int`,
      next: min(sql`case when ${gitBackupRepos.status} <> 'gone' then ${gitBackupRepos.nextDueAt} end`),
    })
    .from(gitBackupRepos)
    .where(eq(gitBackupRepos.jobId, j.id))
  const [snaps] = await db
    .select({ n: count(), bytes: sum(gitBackupSnapshots.size) })
    .from(gitBackupSnapshots)
    .innerJoin(gitBackupRepos, eq(gitBackupRepos.id, gitBackupSnapshots.repoId))
    .where(eq(gitBackupRepos.jobId, j.id))
  return {
    id: j.id,
    name: j.name,
    connection: await connectionOf(j),
    destKind: j.destKind,
    bucket: j.s3Bucket ?? "",
    endpoint: j.s3Endpoint ?? "",
    accessKey: j.s3AccessKey ?? "",
    region: j.s3Region ?? "",
    pathStyle: j.s3PathStyle,
    prefix: j.prefix,
    intervalMin: j.intervalMin,
    keepLast: j.keepLast,
    lfs: j.lfs,
    paused: j.paused,
    autoOwners: j.autoOwners.map((e) => e.split("@")[0]),
    newOnly: j.autoOwners.some((e) => e.includes("@")),
    webhookEnabled: j.webhookEnabled,
    failStreak: j.failStreak,
    lastRunAt: iso(j.lastRunAt),
    lastStatus: j.lastStatus,
    createdAt: j.createdAt.toISOString(),
    repos: agg.repos,
    gone: agg.gone,
    errors: agg.errors,
    snapshots: snaps.n,
    bytes: Number(snaps.bytes ?? 0),
    nextDueAt: agg.next ? new Date(agg.next as unknown as string).toISOString() : null,
  }
}

export async function listJobs(userId: string): Promise<JobView[]> {
  const rows = await db.select().from(gitBackupJobs).where(eq(gitBackupJobs.userId, userId)).orderBy(gitBackupJobs.createdAt)
  return Promise.all(rows.map(view))
}

export async function listRepos(userId: string, jobId: string): Promise<RepoView[]> {
  if (!(await owned(userId, jobId))) return []
  const rows = await db
    .select({
      r: gitBackupRepos,
      n: sql<number>`(select count(*)::int from ${gitBackupSnapshots} s where s.repo_id = git_backup_repos.id)`,
      bytes: sql<number>`(select coalesce(sum(s.size), 0)::float8 from ${gitBackupSnapshots} s where s.repo_id = git_backup_repos.id)`,
    })
    .from(gitBackupRepos)
    .where(eq(gitBackupRepos.jobId, jobId))
    .orderBy(gitBackupRepos.owner, gitBackupRepos.name)
  return rows.map(({ r, n, bytes }) => ({
    id: r.id,
    owner: r.owner,
    name: r.name,
    private: r.private,
    intervalMin: r.intervalMin,
    autoAdded: r.autoAdded,
    status: r.status,
    lastError: r.lastError,
    lastCheckedAt: iso(r.lastCheckedAt),
    lastBackupAt: iso(r.lastBackupAt),
    nextDueAt: r.nextDueAt.toISOString(),
    snapshots: n,
    bytes,
  }))
}

export async function listRuns(userId: string, jobId: string, limit = 30): Promise<RunView[]> {
  if (!(await owned(userId, jobId))) return []
  const rows = await db.select().from(gitBackupRuns).where(eq(gitBackupRuns.jobId, jobId)).orderBy(desc(gitBackupRuns.startedAt)).limit(limit)
  return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt) }))
}

export async function listSnapshots(userId: string, repoId: string): Promise<SnapshotView[]> {
  if (!(await ownedRepo(userId, repoId))) return []
  const rows = await db.select().from(gitBackupSnapshots).where(eq(gitBackupSnapshots.repoId, repoId)).orderBy(desc(gitBackupSnapshots.createdAt)).limit(1000)
  return rows.map((s) => ({ id: s.id, key: s.key, sha: s.sha, refs: s.refs, size: s.size, lfs: s.lfs, createdAt: s.createdAt.toISOString() }))
}

// What the picker needs: the repos the connection can see, with the ones a job already has marked.
export async function pickerFor(userId: string, ref: Ref, refresh = false) {
  const cfg = await connCfg(userId, ref)
  if ("error" in cfg) return cfg
  try {
    return await repoList(cfg.key, cfg, refresh)
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ---- changing ---------------------------------------------------------------------------------------------

// Whole-owner and "*" scopes also add the matching repos that exist now; newOnly owners add only repos made later.
export type NewJob = Settings & { connection: Ref; dest: DestInput; repos: string[] }

export async function createJob(userId: string, v: NewJob): Promise<{ id?: string; error?: string }> {
  const c = await checkSettings(v)
  if ("error" in c) return c
  if (!v.repos?.length && !c.value.autoOwners.length) return { error: "Pick at least one repo." }
  const [dup] = await db.select({ id: gitBackupJobs.id }).from(gitBackupJobs).where(and(eq(gitBackupJobs.userId, userId), sql`lower(${gitBackupJobs.name}) = ${c.value.name.toLowerCase()}`))
  if (dup) return { error: `You already have a job called “${c.value.name}”.` }
  const picked = await pick(userId, v.connection, v.repos)
  if ("error" in picked) return picked
  if (unreachable(c.value.autoOwners, picked.owners)) return { error: "One of the owners to auto-include isn't reachable with this token." }
  // Only from the host's own list (pick), never from the request.
  const have = new Set(picked.rows.map((r) => `${r.owner}/${r.name}`.toLowerCase()))
  for (const r of picked.all) if (inScope(c.value.autoOwners, r) && !have.has(r.fullName.toLowerCase())) picked.rows.push({ owner: r.owner, name: r.name, cloneUrl: r.cloneUrl, private: r.private })
  const dest = await prepareDest(userId, c.value.name, v.dest)
  if ("error" in dest) return dest
  try {
    const job = await db.transaction(async (tx) => {
      const [j] = await tx
        .insert(gitBackupJobs)
        .values({ userId, ...c.value, connectionId: v.connection.connectionId ?? null, registryConnectionId: v.connection.registryConnectionId ?? null, ...dest.fields })
        .returning({ id: gitBackupJobs.id })
      if (picked.rows.length) await tx.insert(gitBackupRepos).values(picked.rows.map((r) => ({ ...r, jobId: j.id })))
      return j
    })
    await audit("git_backup_job_create", { detail: `${c.value.name}: ${picked.rows.length} repos` })
    // The first backup starts at once; a runner that isn't up yet only means it waits for the schedule.
    await runner.requestRun(userId, job.id, { trigger: "first" }).catch(() => {})
    return { id: job.id }
  } catch (e) {
    await releaseKey(userId, dest.fields.keyId ?? null)
    throw e
  }
}

export async function updateJob(userId: string, id: string, v: Settings & { connection?: Ref; dest?: DestInput }): Promise<{ error?: string }> {
  const j = await owned(userId, id)
  if (!j) return { error: "That job isn't here." }
  const c = await checkSettings(v, j.autoOwners)
  if ("error" in c) return c
  const [dup] = await db.select({ id: gitBackupJobs.id }).from(gitBackupJobs).where(and(eq(gitBackupJobs.userId, userId), sql`lower(${gitBackupJobs.name}) = ${c.value.name.toLowerCase()}`))
  if (dup && dup.id !== id) return { error: `You already have a job called “${c.value.name}”.` }
  // Owners must be ones the (new) token reaches; asked only when they or the connection change.
  if (c.value.autoOwners[0] && c.value.autoOwners[0] !== "*" && (v.connection || c.value.autoOwners.join() !== j.autoOwners.join())) {
    const p = await pick(userId, v.connection ?? (j.connectionId ? { connectionId: j.connectionId } : { registryConnectionId: j.registryConnectionId! }), [])
    if ("error" in p) return p
    if (unreachable(c.value.autoOwners, p.owners)) return { error: "One of the owners to auto-include isn't reachable with this token." }
  }
  const set: Partial<typeof gitBackupJobs.$inferInsert> = { ...c.value }
  if (v.connection) {
    const cfg = await connCfg(userId, v.connection)
    if ("error" in cfg) return cfg
    set.connectionId = v.connection.connectionId ?? null
    set.registryConnectionId = v.connection.registryConnectionId ?? null
  }
  let oldKey: string | null = null
  if (v.dest) {
    // A blank secret on the same manual S3 keeps the stored one.
    const d = v.dest.kind === "s3" && !v.dest.secret && j.destKind === "s3" && j.s3SecretEnc ? { ...v.dest, secret: decrypt(j.s3SecretEnc) ?? "" } : v.dest
    const dest = await prepareDest(userId, c.value.name, d)
    if ("error" in dest) return dest
    Object.assign(set, dest.fields)
    oldKey = j.keyId
  }
  await db.update(gitBackupJobs).set(set).where(eq(gitBackupJobs.id, id))
  await releaseKey(userId, oldKey)
  await audit("git_backup_job_update", { detail: c.value.name })
  // A wider scope picks up its repos now instead of at the next check (not while paused; a running run keeps going and
  // the new repos wait for the next one). New-only owners have nothing to add yet.
  if (!j.paused && c.value.autoOwners.some((e) => !e.includes("@") && !j.autoOwners.includes(e))) await runner.requestRun(userId, id, { trigger: "first" }).catch(() => {})
  return {}
}

export async function setPaused(userId: string, id: string, paused: boolean): Promise<{ error?: string }> {
  const j = await owned(userId, id)
  if (!j) return { error: "That job isn't here." }
  await db.update(gitBackupJobs).set({ paused }).where(eq(gitBackupJobs.id, id))
  await audit(paused ? "git_backup_job_pause" : "git_backup_job_resume", { detail: j.name })
  return {}
}

// Puts (or removes) a push webhook on each repo; `failed` lists the repos it couldn't reach.
export async function setWebhookEnabled(userId: string, id: string, on: boolean): Promise<{ failed?: string[]; error?: string }> {
  const j = await owned(userId, id)
  if (!j) return { error: "That job isn't here." }
  try {
    const r = await runner.setWebhook(userId, id, on)
    await audit("git_backup_job_webhook", { detail: `${j.name}: ${on ? "on" : "off"}` })
    return { failed: r.failed }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function addRepos(userId: string, id: string, names: string[]): Promise<{ added?: number; error?: string }> {
  const j = await owned(userId, id)
  if (!j) return { error: "That job isn't here." }
  if (!names.length) return { error: "Pick at least one repo." }
  const picked = await pick(userId, j.connectionId ? { connectionId: j.connectionId } : { registryConnectionId: j.registryConnectionId! }, names)
  if ("error" in picked) return picked
  const added = await db.insert(gitBackupRepos).values(picked.rows.map((r) => ({ ...r, jobId: id }))).onConflictDoNothing().returning({ id: gitBackupRepos.id })
  await audit("git_backup_repos_add", { detail: `${j.name}: ${added.length} repos` })
  if (added.length) await runner.requestRun(userId, id, { trigger: "manual" }).catch(() => {})
  return { added: added.length }
}

export async function removeRepo(userId: string, repoId: string): Promise<{ error?: string }> {
  const r = await ownedRepo(userId, repoId)
  if (!r) return {}
  // Stored archives stay in the bucket; only the tracking row and its history go.
  await db.delete(gitBackupRepos).where(eq(gitBackupRepos.id, repoId))
  await audit("git_backup_repo_remove", { detail: `${r.job.name}: ${r.r.owner}/${r.r.name}` })
  return {}
}

// minutes null: follow the job's interval again.
export async function setRepoInterval(userId: string, repoId: string, minutes: number | null): Promise<{ error?: string }> {
  const r = await ownedRepo(userId, repoId)
  if (!r) return { error: "That repo isn't here." }
  if (minutes !== null) {
    const bad = await intervalError(minutes, "This repo's interval")
    if (bad) return { error: bad }
  }
  await db.update(gitBackupRepos).set({ intervalMin: minutes, nextDueAt: new Date() }).where(eq(gitBackupRepos.id, repoId))
  return {}
}

export async function backupNow(userId: string, id: string, o: { force?: boolean; repoId?: string }): Promise<{ error?: string }> {
  const j = await owned(userId, id)
  if (!j) return { error: "That job isn't here." }
  const repoId = o.repoId ? String(o.repoId) : undefined
  if (repoId && !(/^[0-9a-f-]{36}$/i.test(repoId) && (await db.select({ id: gitBackupRepos.id }).from(gitBackupRepos).where(and(eq(gitBackupRepos.id, repoId), eq(gitBackupRepos.jobId, id))))[0])) return { error: "That repo isn't here." }
  try {
    const r = await runner.requestRun(userId, id, { trigger: "manual", force: Boolean(o.force), repoId })
    return r.started ? {} : { error: "A backup is already running." }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// purge: also delete the stored archives.
export async function deleteJob(userId: string, id: string, purge: boolean): Promise<{ error?: string }> {
  const j = await owned(userId, id)
  if (!j) return {}
  if (purge) {
    try {
      await runner.purgeJobArchives(userId, id)
    } catch (e) {
      return { error: `Couldn't delete the stored backups: ${(e as Error).message}. The job is kept.` }
    }
  }
  await db.delete(gitBackupJobs).where(eq(gitBackupJobs.id, id))
  await releaseKey(userId, j.keyId)
  await audit("git_backup_job_delete", { detail: `${j.name}${purge ? " (and backups)" : ""}` })
  return {}
}
