// Git Backup runner. The UI (app/(app)/more/github-backup) calls the exported functions; the worker
// runs a run through /api/jobs ("git-backup-run" -> runJob). Every function checks that `userId` owns the job/snapshot.
import "server-only"

import { randomBytes } from "node:crypto"
import { readdir, rm, stat, utimes } from "node:fs/promises"
import { join } from "node:path"

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"

import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos, gitBackupRuns, gitBackupSnapshots, settings } from "@/lib/db/schema"
import { appUrl } from "@/lib/email"
import { decrypt, encrypt } from "@/lib/crypto"
import { enqueueGitBackup, redis } from "@/lib/redis"
import { checkUrl, dialable } from "@/lib/secrets/webhooks"
import pkg from "../../package.json"
import { alertFailing } from "./alerts"
import { catFile, extract, headInfo, sealBare, lfsFetch, lsRemote, lsTree, mirror, pack, push, refNames, usesLfs, WORK } from "./archive"
import { download, open, presign, putJson, removeArchives, upload } from "./dest"
import { jobToken } from "./connections"
import { repoList } from "./github"
import { failureKind, hashRefs, inScope, manifestKey, pickPrune, snapshotKey } from "./refs"

export type Trigger = "schedule" | "manual" | "webhook" | "first"
export type RepoStage = "queued" | "checking" | "cloning" | "packing" | "uploading" | "done" | "skipped" | "failed"
export type Progress = { runId: string; startedAt: string; repos: { repoId: string; repo: string; stage: RepoStage; bytes?: number }[] } | null
export type TreeEntry = { path: string; type: "blob" | "tree"; size: number | null }

type Job = typeof gitBackupJobs.$inferSelect
type Repo = typeof gitBackupRepos.$inferSelect
type Result = (typeof gitBackupRuns.$inferSelect)["results"][number]

const progressKey = (jobId: string) => `gitbackup:progress:${jobId}`
const PROGRESS_TTL = 6 * 3600
const VIEW_CAP = 1024 * 1024

async function ownJob(userId: string, jobId: string) {
  const [job] = await db.select().from(gitBackupJobs).where(and(eq(gitBackupJobs.id, jobId), eq(gitBackupJobs.userId, userId)))
  if (!job) throw new Error("Backup job not found.")
  return job
}

async function ownSnapshot(userId: string, snapshotId: string) {
  const [row] = await db
    .select({ snap: gitBackupSnapshots, repo: gitBackupRepos, job: gitBackupJobs })
    .from(gitBackupSnapshots)
    .innerJoin(gitBackupRepos, eq(gitBackupRepos.id, gitBackupSnapshots.repoId))
    .innerJoin(gitBackupJobs, eq(gitBackupJobs.id, gitBackupRepos.jobId))
    .where(and(eq(gitBackupSnapshots.id, snapshotId), eq(gitBackupJobs.userId, userId)))
  if (!row) throw new Error("Snapshot not found.")
  return row
}

const hostOf = (cloneUrl: string) => new URL(cloneUrl).hostname
const minutes = (repo: Repo, job: Job) => repo.intervalMin ?? job.intervalMin

// ---- starting runs --------------------------------------------------------------------------------

// Opens a run row and queues it, unless the job already has one running (that one's id comes back).
export async function startRun(job: Job, o: { trigger: Trigger; force?: boolean; repoIds: string[] }) {
  const [running] = await db.select({ id: gitBackupRuns.id }).from(gitBackupRuns).where(and(eq(gitBackupRuns.jobId, job.id), eq(gitBackupRuns.status, "running")))
  if (running) return { runId: running.id, started: false }
  const repos = o.repoIds.length ? await db.select().from(gitBackupRepos).where(inArray(gitBackupRepos.id, o.repoIds)) : []
  const [run] = await db
    .insert(gitBackupRuns)
    .values({ jobId: job.id, trigger: o.trigger, force: Boolean(o.force) })
    .onConflictDoNothing()
    .returning({ id: gitBackupRuns.id })
  // Lost a race with another start (one running run per job, git_backup_runs_one_running_idx).
  if (!run) {
    const [other] = await db.select({ id: gitBackupRuns.id }).from(gitBackupRuns).where(and(eq(gitBackupRuns.jobId, job.id), eq(gitBackupRuns.status, "running")))
    return { runId: other?.id ?? "", started: false }
  }
  await writeProgress(job.id, { runId: run.id, startedAt: new Date().toISOString(), repos: repos.map((r) => ({ repoId: r.id, repo: `${r.owner}/${r.name}`, stage: "queued" as const })) })
  await enqueueGitBackup({ runId: run.id, repoIds: o.repoIds })
  return { runId: run.id, started: true }
}

// Queue a run now (whole job, or one repo). force: snapshot even if refs are unchanged.
// started: false when the job already had a run going (runId is that run; nothing new was queued).
export async function requestRun(userId: string, jobId: string, o: { trigger: Trigger; force?: boolean; repoId?: string }): Promise<{ runId: string; started: boolean }> {
  const job = await ownJob(userId, jobId)
  const [s] = await db.select({ on: settings.gitBackupEnabled }).from(settings)
  if (!s?.on) throw new Error("Git Backup is turned off by an admin.")
  // "Back up now" for the whole job also picks up repos that appeared since the last check.
  if (!o.repoId) await addAutoRepos(job)
  const repos = await db
    .select({ id: gitBackupRepos.id })
    .from(gitBackupRepos)
    .where(and(eq(gitBackupRepos.jobId, jobId), o.repoId ? eq(gitBackupRepos.id, o.repoId) : ne(gitBackupRepos.status, "gone")))
  if (o.repoId && !repos.length) throw new Error("Repository not found in this job.")
  return startRun(job, { ...o, repoIds: repos.map((r) => r.id) })
}

// ---- progress -------------------------------------------------------------------------------------

async function writeProgress(jobId: string, p: NonNullable<Progress>) {
  await redis.set(progressKey(jobId), JSON.stringify(p), "EX", PROGRESS_TTL).catch(() => {})
}

// Live progress of the job's running run, null when idle.
export async function progress(userId: string, jobId: string): Promise<Progress> {
  await ownJob(userId, jobId)
  const raw = await redis.get(progressKey(jobId)).catch(() => null)
  return raw ? (JSON.parse(raw) as Progress) : null
}

// ---- running --------------------------------------------------------------------------------------

// Repos in the job's scope (refs.ts scopeRule; forks and archived repos included) that it doesn't have yet; their ids come back so this run backs them up. Failing to list isn't a failing backup.
async function addAutoRepos(job: Job): Promise<string[]> {
  if (!job.autoOwners.length) return []
  try {
    const conn = await jobToken(job)
    const found = (await repoList(`job:${job.id}`, conn, true)).repos.filter((r) => inScope(job.autoOwners, r))
    if (!found.length) return []
    const added = await db
      .insert(gitBackupRepos)
      .values(found.map((r) => ({ jobId: job.id, owner: r.owner, name: r.name, cloneUrl: r.cloneUrl, private: r.private, autoAdded: true })))
      .onConflictDoNothing()
      .returning({ id: gitBackupRepos.id })
    return added.map((r) => r.id)
  } catch (e) {
    console.error(`[gitbackup] auto-include for job ${job.id}:`, (e as Error).message)
    return []
  }
}

// The worker's entry: one run, its repos one after another. Always finishes the run row.
export async function runJob(runId: string, repoIds: string[]) {
  const [run] = await db.select().from(gitBackupRuns).where(eq(gitBackupRuns.id, runId))
  if (!run || run.status !== "running") return
  const [job] = await db.select().from(gitBackupJobs).where(eq(gitBackupJobs.id, run.jobId))
  const results: Result[] = []
  let bytes = 0
  const work = join(WORK, runId)
  const prog: NonNullable<Progress> = { runId, startedAt: run.startedAt.toISOString(), repos: [] }
  try {
    if (!job) throw new Error("The job was deleted.")
    // Runs started through requestRun ("first", "manual") already looked for new repos.
    const ids = run.trigger === "schedule" ? [...repoIds, ...(await addAutoRepos(job))] : repoIds
    const conn = await jobToken(job)
    const dest = open(job)
    // Asked once per run, only after an access error: is the token itself still good?
    let checked: Promise<TokenState> | undefined
    const tokenState = () =>
      (checked ??= gh(apiBase(conn.host), conn.token, "GET", "/user").then(
        () => "ok" as const,
        (e: Error) => (/answered 401/.test(e.message) ? ("rejected" as const) : ("unknown" as const))
      ))
    const repos = ids.length ? await db.select().from(gitBackupRepos).where(inArray(gitBackupRepos.id, ids)).orderBy(asc(gitBackupRepos.owner), asc(gitBackupRepos.name)) : []
    prog.repos = repos.map((r) => ({ repoId: r.id, repo: `${r.owner}/${r.name}`, stage: "queued" as const }))
    await writeProgress(job.id, prog)
    for (const [i, repo] of repos.entries()) {
      const stage = (s: RepoStage, n?: number) => {
        prog.repos[i] = { ...prog.repos[i], stage: s, ...(n !== undefined && { bytes: n }) }
        return writeProgress(job.id, prog)
      }
      const r = await backupRepo({ job, repo, token: conn.token, dest, runId, force: run.force, work: join(work, repo.id), stage, tokenState })
      results.push(r)
      bytes += r.size ?? 0
    }
  } catch (e) {
    results.push({ repoId: "", repo: "", outcome: "failed", error: (e as Error).message.slice(0, 300) })
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
    await redis.del(progressKey(run.jobId)).catch(() => {})
  }
  const failed = results.filter((r) => r.outcome === "failed").length
  const status = !failed ? "ok" : failed === results.length ? "failed" : "partial"
  await db
    .update(gitBackupRuns)
    .set({ status, checked: results.length, changed: results.filter((r) => r.outcome === "backed_up").length, failed, bytes, results, finishedAt: new Date() })
    .where(eq(gitBackupRuns.id, runId))
  if (!job) return
  const streak = status === "ok" ? 0 : job.failStreak + 1
  await db
    .update(gitBackupJobs)
    .set({ lastRunAt: new Date(), lastStatus: status, failStreak: streak, ...(status === "ok" && { alertedAt: null }) })
    .where(eq(gitBackupJobs.id, job.id))
  if (streak >= 2 && !job.alertedAt) await alertFailing(job, streak, results.find((r) => r.outcome === "failed")?.error)
}

type TokenState = "ok" | "rejected" | "unknown"
type Ctx = {
  job: Job
  repo: Repo
  token: string
  dest: ReturnType<typeof open>
  runId: string
  force: boolean
  work: string
  stage: (s: RepoStage, bytes?: number) => Promise<unknown>
  tokenState: () => Promise<TokenState>
}
export const TOKEN_REJECTED = "The connection's token was rejected — replace it in Settings."

async function backupRepo(c: Ctx): Promise<Result> {
  const { job, repo } = c
  const name = `${repo.owner}/${repo.name}`
  const next = () => new Date(Date.now() + minutes(repo, job) * 60_000)
  const auth = { token: c.token }
  try {
    await c.stage("checking")
    const refs = await lsRemote(repo.cloneUrl, auth)
    const hash = hashRefs(refs)
    if (hash === repo.refsHash && !c.force) {
      await db.update(gitBackupRepos).set({ status: "ok", lastError: null, lastCheckedAt: new Date(), nextDueAt: next() }).where(eq(gitBackupRepos.id, repo.id))
      await c.stage("skipped")
      return { repoId: repo.id, repo: name, outcome: "skipped" }
    }
    await c.stage("cloning")
    const folder = `${repo.name}.git`
    const dir = join(c.work, folder)
    await mirror(repo.cloneUrl, dir, auth)
    const lfs = job.lfs && (await usesLfs(dir))
    if (lfs) await lfsFetch(dir, repo.cloneUrl, auth)
    const head = await headInfo(dir)
    const now = new Date()
    const key = snapshotKey(job.prefix, hostOf(repo.cloneUrl), repo.owner, repo.name, now, head.sha)
    await c.stage("packing")
    await c.stage("uploading")
    let shown = 0
    const tar = pack(c.work, folder, (n) => {
      if (n - shown < 4 * 2 ** 20) return
      shown = n
      void c.stage("uploading", n)
    })
    try {
      await upload(c.dest.s3, c.dest.bucket, key, tar.body)
      await tar.done
    } catch (e) {
      await removeArchives(c.dest, [key]).catch(() => {})
      throw e
    }
    const size = tar.size()
    await putJson(c.dest, manifestKey(key), { repo: name, refs, defaultBranch: head.defaultBranch, head: head.sha, lfs, size, createdAt: now.toISOString(), nimbus: pkg.version })
    const [snap] = await db.insert(gitBackupSnapshots).values({ repoId: repo.id, runId: c.runId, key, sha: head.sha, refs: Object.keys(refs).length, size, lfs }).returning({ id: gitBackupSnapshots.id })
    await db.update(gitBackupRepos).set({ refsHash: hash, status: "ok", lastError: null, lastCheckedAt: now, lastBackupAt: now, nextDueAt: next() }).where(eq(gitBackupRepos.id, repo.id))
    await prune(job, repo.id, c.dest).catch((e) => console.error(`[gitbackup] retention for ${name}:`, e.message))
    await c.stage("done", size)
    return { repoId: repo.id, repo: name, outcome: "backed_up", size, snapshotId: snap.id }
  } catch (e) {
    const kind = failureKind((e as Error).message)
    const token = kind ? await c.tokenState() : "ok"
    const error = token === "rejected" ? TOKEN_REJECTED : (e as Error).message.slice(0, 300)
    // Gone only when the token works and the host still says no such repo. A gone repo isn't checked again;
    // its snapshots stay (retention only runs after a good upload).
    const gone = kind === "missing" && token === "ok"
    await db.update(gitBackupRepos).set({ status: gone ? "gone" : "error", lastError: error, lastCheckedAt: new Date(), nextDueAt: next() }).where(eq(gitBackupRepos.id, repo.id))
    await c.stage("failed")
    return gone ? { repoId: repo.id, repo: name, outcome: "gone", error } : { repoId: repo.id, repo: name, outcome: "failed", error }
  } finally {
    await rm(c.work, { recursive: true, force: true }).catch(() => {})
  }
}

// Keeps the newest keepLast snapshots of the repo. Rows go only once their objects did.
async function prune(job: Job, repoId: string, dest: ReturnType<typeof open>) {
  const snaps = await db.select().from(gitBackupSnapshots).where(eq(gitBackupSnapshots.repoId, repoId)).orderBy(desc(gitBackupSnapshots.createdAt))
  const old = pickPrune(snaps, job.keepLast)
  if (!old.length) return
  await removeArchives(dest, old.map((s) => s.key))
  await db.delete(gitBackupSnapshots).where(inArray(gitBackupSnapshots.id, old.map((s) => s.id)))
}

// ---- restore --------------------------------------------------------------------------------------

// Short-lived download URL for a snapshot's .tar.gz.
export async function snapshotDownloadUrl(userId: string, snapshotId: string): Promise<string> {
  const { snap, job } = await ownSnapshot(userId, snapshotId)
  return presign(open(job), snap.key, snap.key.split("/").pop()!)
}

// Shell commands that download and restore the snapshot (curl + tar + git clone).
export async function restoreCommand(userId: string, snapshotId: string): Promise<string> {
  const { snap, repo } = await ownSnapshot(userId, snapshotId)
  const url = await snapshotDownloadUrl(userId, snapshotId)
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  return [`curl -fL -o ${q(`${repo.name}.tar.gz`)} ${q(url)}`, `tar xzf ${q(`${repo.name}.tar.gz`)}`, `git clone ${q(`${repo.name}.git`)} ${q(repo.name)}`].join("\n")
}

// Where a snapshot is unpacked for browsing and pushing; one folder per snapshot, thrown away after 15 minutes idle.
const UNPACKED_MS = 15 * 60_000
const unpacking = new Map<string, Promise<string>>()

async function unpacked(job: Job, snapshotId: string, key: string) {
  const folder = join(WORK, `snap-${snapshotId}`)
  // While one unpack runs the folder already looks fresh, so the in-flight one is checked first.
  let p = unpacking.get(snapshotId)
  if (!p && !(await stat(folder).then((s) => Date.now() - s.mtimeMs < UNPACKED_MS, () => false))) {
    const d = open(job)
    p = (async () => {
      await rm(folder, { recursive: true, force: true })
      try {
        await extract(await download(d.s3, d.bucket, key), folder)
        const dirs = await readdir(folder)
        if (dirs.length !== 1 || !dirs[0].endsWith(".git")) throw new Error("This snapshot isn't a Git Backup archive.")
        await sealBare(join(folder, dirs[0]))
      } catch (e) {
        await rm(folder, { recursive: true, force: true })
        throw e
      }
      return folder
    })().finally(() => unpacking.delete(snapshotId))
    unpacking.set(snapshotId, p)
  }
  if (p) await p
  await utimes(folder, new Date(), new Date())
  const [bare] = await readdir(folder)
  return join(folder, bare)
}

// Called by the scheduler tick.
export async function sweepUnpacked() {
  for (const n of await readdir(WORK).catch(() => [] as string[]))
    if (n.startsWith("snap-") && (await stat(join(WORK, n)).then((s) => Date.now() - s.mtimeMs > UNPACKED_MS, () => false))) await rm(join(WORK, n), { recursive: true, force: true })
}

// Push every ref of the snapshot to an empty remote. token: optional HTTPS token for that remote.
export async function pushSnapshot(userId: string, snapshotId: string, remoteUrl: string, token?: string): Promise<void> {
  const { snap, job } = await ownSnapshot(userId, snapshotId)
  const url = remoteUrl.trim()
  const ssh = /^git@([A-Za-z0-9.-]+):[\w./-]+$/.exec(url)
  if (ssh) await dialable(new URL(`https://${ssh[1]}`))
  else if (url.startsWith("https://")) await dialable(checkUrl(url))
  else throw new Error("The remote must be an https:// URL or a git@host:path address.")
  await push(await unpacked(job, snapshotId, snap.key), url, { token, protocols: ssh ? "ssh" : "https", noRedirects: true }, snap.lfs)
}

async function browse(userId: string, snapshotId: string, ref?: string) {
  const { snap, job } = await ownSnapshot(userId, snapshotId)
  const dir = await unpacked(job, snapshotId, snap.key)
  const full = await refNames(dir)
  const refs = full.map((r) => r.replace(/^refs\/(heads|tags)\//, ""))
  const head = (await headInfo(dir)).defaultBranch
  const chosen = ref ?? (head && refs.includes(head) ? head : refs[0])
  if (chosen && !refs.includes(chosen)) throw new Error("That branch or tag isn't in this snapshot.")
  return { dir, refs, ref: chosen ?? "" }
}

// Browse a snapshot at a ref (default: its default branch).
export async function snapshotTree(userId: string, snapshotId: string, o: { ref?: string; path?: string }): Promise<{ refs: string[]; ref: string; entries: TreeEntry[] }> {
  const { dir, refs, ref } = await browse(userId, snapshotId, o.ref)
  const path = (o.path ?? "").replace(/^\/+|\/+$/g, "")
  return { refs, ref, entries: ref ? await lsTree(dir, ref, path) : [] }
}

export async function snapshotFile(userId: string, snapshotId: string, o: { ref?: string; path: string }): Promise<{ size: number; binary: boolean; text: string | null }> {
  const { dir, ref } = await browse(userId, snapshotId, o.ref)
  if (!ref) throw new Error("This snapshot has no files.")
  const { size, body } = await catFile(dir, ref, o.path.replace(/^\/+/, ""), VIEW_CAP)
  const binary = body.subarray(0, 8000).includes(0)
  return { size, binary, text: binary ? null : body.toString("utf8") }
}

// Delete a job's stored archives too (used when the user deletes a job and ticks "delete backups").
export async function purgeJobArchives(userId: string, jobId: string): Promise<void> {
  const job = await ownJob(userId, jobId)
  const snaps = await db
    .select({ id: gitBackupSnapshots.id, key: gitBackupSnapshots.key })
    .from(gitBackupSnapshots)
    .innerJoin(gitBackupRepos, eq(gitBackupRepos.id, gitBackupSnapshots.repoId))
    .where(eq(gitBackupRepos.jobId, job.id))
  if (!snaps.length) return
  await removeArchives(open(job), snaps.map((s) => s.key))
  await db.delete(gitBackupSnapshots).where(inArray(gitBackupSnapshots.id, snaps.map((s) => s.id)))
}

// ---- push webhook ---------------------------------------------------------------------------------

const hookUrl = (jobId: string) => appUrl(`/api/gitbackup/webhook/${jobId}`)
const apiBase = (host: string | null) => (host ? `https://${host}/api/v3` : (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""))

// ponytail: GitHub only; and repos added to the job later (auto-include) get no hook until this is toggled again.
async function gh(base: string, token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nimbus-gitbackup", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return res.status === 204 ? null : res.json()
}

// Turns the job's push webhook on (a hook on each repo, one shared secret) or off. Returns the repos it couldn't reach.
export async function setWebhook(userId: string, jobId: string, on: boolean): Promise<{ failed: string[] }> {
  const job = await ownJob(userId, jobId)
  const conn = await jobToken(job)
  const base = apiBase(conn.host)
  const secret = randomBytes(24).toString("hex")
  const url = hookUrl(jobId)
  const failed: string[] = []
  for (const r of await db.select().from(gitBackupRepos).where(eq(gitBackupRepos.jobId, jobId))) {
    const full = `${r.owner}/${r.name}`
    try {
      // Ours only (by URL), so a second toggle doesn't stack hooks.
      const hooks = (await gh(base, conn.token, "GET", `/repos/${full}/hooks?per_page=100`)) as { id: number; config?: { url?: string } }[]
      for (const h of hooks.filter((h) => h.config?.url === url)) await gh(base, conn.token, "DELETE", `/repos/${full}/hooks/${h.id}`)
      if (on) await gh(base, conn.token, "POST", `/repos/${full}/hooks`, { name: "web", active: true, events: ["push", "create"], config: { url, content_type: "json", secret, insecure_ssl: "0" } })
    } catch (e) {
      failed.push(`${full}: ${(e as Error).message}`)
    }
  }
  await db.update(gitBackupJobs).set({ webhookEnabled: on, webhookSecretEnc: on ? encrypt(secret) : null }).where(eq(gitBackupJobs.id, jobId))
  return { failed }
}

export const webhookSecret = (job: Job) => (job.webhookSecretEnc ? decrypt(job.webhookSecretEnc) : null)
