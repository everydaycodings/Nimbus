// Server Backup runs. requestRun/startRun queue one (the worker hands it to /api/jobs -> runServerBackup); a run pulls
// each source from the server over ssh as one tar and streams it into restic, which encrypts, dedupes and uploads it.
import "server-only"

import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"

import { and, eq, lt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { serverBackupHosts, serverBackupJobs, serverBackupRuns, serverBackupSnapshots, settings, user } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { enqueueServerBackup } from "@/lib/redis"
import { CACHE, dockerSocket, exec, missingBinary, repoOf, run, sshProblem, withTransport, type Host, type Job, type Transport } from "./exec"
import { ownedHost } from "./hosts"
import { containersOf, forgetArgs, parseBackupLine, pathsTar, resticHost, sourceFile, sourceOfFile, tail, volumeTar } from "./rules"

type Trigger = "schedule" | "manual" | "first" | "agent"

const enabled = async () => Boolean((await db.select({ on: settings.serverBackupEnabled }).from(settings))[0]?.on)

// ---- starting ------------------------------------------------------------------------------------------------------

// Opens a run row and queues it, unless the job already has one running.
export async function startRun(job: Job, trigger: Trigger): Promise<{ runId: string; started: boolean }> {
  const [row] = await db.insert(serverBackupRuns).values({ jobId: job.id, trigger }).onConflictDoNothing().returning({ id: serverBackupRuns.id })
  if (!row) {
    const [other] = await db.select({ id: serverBackupRuns.id }).from(serverBackupRuns).where(and(eq(serverBackupRuns.jobId, job.id), eq(serverBackupRuns.status, "running")))
    return { runId: other?.id ?? "", started: false }
  }
  // The next one counts from now, so the minute tick doesn't start a second.
  await db.update(serverBackupJobs).set({ nextDueAt: sql`now() + make_interval(mins => ${job.intervalMin})` }).where(eq(serverBackupJobs.id, job.id))
  await enqueueServerBackup({ runId: row.id })
  return { runId: row.id, started: true }
}

// An agent's run: only the row (the agent does the work); null while one is already open.
export async function startAgentRun(jobId: string): Promise<string | null> {
  const [row] = await db.insert(serverBackupRuns).values({ jobId, trigger: "agent", stage: "Running on the server" }).onConflictDoNothing().returning({ id: serverBackupRuns.id })
  return row?.id ?? null
}

export async function requestRun(userId: string, jobId: string, trigger: Trigger) {
  const [job] = await db.select().from(serverBackupJobs).where(and(eq(serverBackupJobs.id, jobId), eq(serverBackupJobs.userId, userId)))
  if (!job) throw new Error("Backup job not found.")
  if (!(await enabled())) throw new Error("Server Backup is turned off by an admin.")
  return startRun(job, trigger)
}

// ---- running -------------------------------------------------------------------------------------------------------

// Keeps the run row's progress and log tail current without writing on every line.
function reporter(runId: string) {
  let last = 0
  let logTail = ""
  const pending: Partial<typeof serverBackupRuns.$inferInsert> = {}
  const flush = async (force = false) => {
    if (!force && Date.now() - last < 2000) return
    last = Date.now()
    const set = { ...pending, logTail }
    for (const k of Object.keys(pending)) delete pending[k as keyof typeof pending]
    await db.update(serverBackupRuns).set(set).where(eq(serverBackupRuns.id, runId)).catch(() => {})
  }
  return {
    log: (line: string) => {
      logTail = tail(`${logTail}${line.endsWith("\n") ? line : `${line}\n`}`, 6000)
    },
    set: (p: typeof pending) => {
      Object.assign(pending, p)
      return flush()
    },
    flush: () => flush(true),
    text: () => logTail,
  }
}
type Reporter = ReturnType<typeof reporter>

const lastLines = (s: string, n = 4) => s.trim().split("\n").slice(-n).join(" ").slice(0, 600)

// restic init on the first run; a wrong password or an unreachable bucket stops here with restic's own words.
async function ensureRepo(job: Job, rep: Reporter) {
  await mkdir(CACHE, { recursive: true })
  const have = await run(job, ["cat", "config"])
  const miss = missingBinary(have, "restic")
  if (miss) throw new Error(miss)
  if (have.code === 0) return
  if (/wrong password|no key found/i.test(have.err)) throw new Error("The repository password doesn't match. The repository in this bucket belongs to another job.")
  rep.log("Making the repository")
  const init = await run(job, ["init"])
  if (init.code !== 0) throw new Error(`Couldn't make the repository: ${lastLines(init.err || have.err)}`)
}

const sources = (job: Job) => [...(job.paths.length ? ["paths"] : []), ...job.volumes.map((v) => `volume:${v}`)]

// One source: ssh runs tar on the server, restic reads that stream from `--stdin-from-command`. The file name inside the
// snapshot is the same every run, so restic's chunks line up and an unchanged source adds almost nothing.
async function backupSource(job: Job, host: Host, t: Transport, source: string, i: number, n: number, rep: Reporter) {
  const inner = source === "paths" ? pathsTar(job.paths, job.excludes) : volumeTar(source.slice("volume:".length))
  const c = t(inner)
  const r = repoOf(job)
  const args = [...r.opts, "backup", "--json", "--host", resticHost(host.id), "--stdin-from-command", "--stdin-filename", sourceFile(source), "--", c.file, ...c.args]
  const label = source === "paths" ? "folders" : `volume ${source.slice(7)}`
  await rep.set({ stage: `Backing up ${label}${n > 1 ? ` (${i + 1} of ${n})` : ""}` })
  const p = spawn("restic", args, { env: r.env as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] })
  let buf = ""
  let err = ""
  const got: { summary?: Extract<NonNullable<ReturnType<typeof parseBackupLine>>, { kind: "summary" }> } = {}
  p.stdout.on("data", (b: Buffer) => {
    buf += b
    const ls = buf.split("\n")
    buf = ls.pop() ?? ""
    for (const l of ls) {
      const m = parseBackupLine(l)
      if (m?.kind === "summary") got.summary = m
      else if (m?.kind === "status") void rep.set({ progress: m.percent === null ? null : (i + m.percent) / n, bytes: m.bytes, files: m.files })
    }
  })
  p.stderr.on("data", (b: Buffer) => ((err = tail(err + b, 6000)), rep.log(String(b).trimEnd())))
  const code = await new Promise<number | null>((resolve) => (p.on("error", (e) => ((err += e.message), resolve(null))), p.on("close", resolve)))
  const summary = got.summary
  if (code !== 0 || !summary) throw new Error(sshProblem(err, host))
  rep.log(`${label}: ${summary.files} files, ${summary.bytes} bytes read, ${summary.added} bytes added`)
  return summary
}

async function hook(t: Transport, cmd: string, what: string, rep: Reporter) {
  rep.log(`Running the ${what}`)
  const r = await exec(t(cmd), { timeout: 3_600_000 })
  if (r.out.trim()) rep.log(tail(r.out.trim(), 1500))
  if (r.err.trim()) rep.log(tail(r.err.trim(), 1500))
  if (r.code !== 0) throw new Error(`The ${what} failed${r.code === null ? "" : ` (exit ${r.code})`}: ${lastLines(r.err || r.out)}`)
}

// Mirrors `restic snapshots` into the table the page reads.
export async function syncSnapshots(job: Job, host: Host) {
  const r = await run(job, ["snapshots", "--json", "--host", resticHost(host.id)])
  if (r.code !== 0) throw new Error(`Couldn't list the snapshots: ${lastLines(r.err)}`)
  const list = JSON.parse(r.out || "[]") as { id: string; time: string; paths?: string[]; summary?: { total_bytes_processed?: number; data_added?: number } }[]
  const rows = list.flatMap((s) => {
    const paths = s.paths ?? []
    const kind = host.mode === "agent" ? ("files" as const) : ("tar" as const)
    const source = kind === "tar" ? sourceOfFile(paths[0] ?? "") : paths.join(", ")
    if (source === null) return []
    return [{ jobId: job.id, resticId: s.id, takenAt: new Date(s.time), source, kind, paths, bytes: s.summary?.total_bytes_processed ?? null, addedBytes: s.summary?.data_added ?? null }]
  })
  await db.transaction(async (tx) => {
    const ids = rows.map((x) => x.resticId)
    if (ids.length) await tx.execute(sql`delete from server_backup_snapshots where job_id = ${job.id} and restic_id not in ${ids}`)
    else await tx.delete(serverBackupSnapshots).where(eq(serverBackupSnapshots.jobId, job.id))
    for (const row of rows)
      await tx.insert(serverBackupSnapshots).values(row).onConflictDoUpdate({ target: [serverBackupSnapshots.jobId, serverBackupSnapshots.resticId], set: { bytes: row.bytes, addedBytes: row.addedBytes, source: row.source, paths: row.paths } })
  })
}

// The worker's entry: one run. Always finishes the run row.
export async function runServerBackup(runId: string) {
  const [r] = await db.select().from(serverBackupRuns).where(eq(serverBackupRuns.id, runId))
  if (!r || r.status !== "running") return
  const [job] = await db.select().from(serverBackupJobs).where(eq(serverBackupJobs.id, r.jobId))
  const [host] = job ? await db.select().from(serverBackupHosts).where(eq(serverBackupHosts.id, job.hostId)) : []
  const rep = reporter(runId)
  let error: string | undefined
  let snapshotId: string | undefined
  let bytes = 0
  let files = 0
  try {
    if (!job || !host) throw new Error("This job's server is gone.")
    if (!(await enabled())) throw new Error("Server Backup is turned off by an admin.")
    if (host.isSelf && !(await dockerSocket())) throw new Error("The Docker socket isn't mounted in this container, so the Nimbus server's volumes can't be read. Mount /var/run/docker.sock into the app service (see the Servers page).")
    await rep.set({ stage: "Checking the repository" })
    await ensureRepo(job, rep)
    await withTransport(host, async (t) => {
      const stopped: string[] = []
      try {
        if (job.preHook.trim()) {
          await rep.set({ stage: "Running the pre-backup command" })
          await hook(t, job.preHook, "pre-backup command", rep)
        }
        if (job.stopContainers)
          for (const v of job.volumes) {
            const ids = (await exec(t(containersOf(v)), { timeout: 60_000 })).out.split(/\s+/).filter((x) => /^[0-9a-f]+$/.test(x))
            if (!ids.length) continue
            await rep.set({ stage: `Stopping containers using ${v}` })
            const s = await exec(t(`docker stop ${ids.join(" ")}`), { timeout: 300_000 })
            stopped.push(...ids)
            if (s.code !== 0) throw new Error(`Couldn't stop the containers: ${lastLines(s.err)}`)
          }
        const all = sources(job)
        let added = 0
        for (const [i, s] of all.entries()) {
          const done = await backupSource(job, host, t, s, i, all.length, rep)
          snapshotId = done.snapshotId
          bytes += done.bytes
          files += done.files
          added += done.added
        }
        rep.log(`Added ${added} bytes to the repository`)
      } catch (e) {
        error = (e as Error).message
      } finally {
        // Always: containers back up, then the post hook.
        if (stopped.length) {
          const s = await exec(t(`docker start ${stopped.join(" ")}`), { timeout: 300_000 })
          if (s.code !== 0) error ??= `Couldn't start the containers again: ${lastLines(s.err)}`
          else rep.log("Started the containers again")
        }
        if (job.postHook.trim()) {
          await hook(t, job.postHook, "post-backup command", rep).catch((e: Error) => {
            error ??= e.message
            rep.log(e.message)
          })
        }
      }
    })
    if (!error) {
      await rep.set({ stage: "Applying retention", progress: null })
      const f = await run(job, ["forget", "--host", resticHost(host.id), ...forgetArgs(job.retention), "--prune"], { timeout: 3_600_000 })
      if (f.code !== 0) error = `Backed up, but removing old snapshots failed: ${lastLines(f.err)}`
      else rep.log("Removed snapshots outside the retention")
    }
    await syncSnapshots(job, host).catch((e: Error) => void (error ??= e.message))
  } catch (e) {
    error = (e as Error).message
  }
  await finish(runId, job, error, { snapshotId, bytes, files }, rep)
}

// Closes the run, moves the job's schedule and streak, and sends the alert after the second failure in a row.
export async function finish(runId: string, job: Job | undefined, error: string | undefined, o: { snapshotId?: string; bytes?: number; files?: number }, rep?: Reporter) {
  await db
    .update(serverBackupRuns)
    .set({ status: error ? "failed" : "ok", error: error ?? null, finishedAt: new Date(), progress: error ? null : 1, stage: error ? "Failed" : "Done", snapshotId: o.snapshotId ?? null, bytes: o.bytes ?? 0, files: o.files ?? 0, ...(rep ? { logTail: rep.text() } : {}) })
    .where(eq(serverBackupRuns.id, runId))
  if (job) await settle(job, error)
}

async function settle(job: Job, error?: string) {
  const [row] = await db.select({ failStreak: serverBackupJobs.failStreak, alertedAt: serverBackupJobs.alertedAt }).from(serverBackupJobs).where(eq(serverBackupJobs.id, job.id))
  if (!row) return
  const streak = error ? row.failStreak + 1 : 0
  await db.execute(sql`update server_backup_jobs set last_run_at = now(), last_status = ${error ? "failed" : "ok"}, fail_streak = ${streak},
    next_due_at = now() + make_interval(mins => interval_min)${error ? sql`` : sql`, alerted_at = null`} where id = ${job.id}`)
  if (streak < 2 || row.alertedAt) return
  const claimed = await db.execute(sql`update server_backup_jobs set alerted_at = now() where id = ${job.id} and alerted_at is null returning id`)
  if (claimed.length) await notify(job.userId, "server_backup", { data: { job: job.name, streak: String(streak), error: error ?? "", href: `/more/server-backup?job=${job.id}&tab=history` } })
}

// ---- the minute tick -----------------------------------------------------------------------------------------------

export { ownedHost }

export async function tick() {
  // A run whose app died without finishing; the worker normally closes these itself.
  const stuck = await db
    .update(serverBackupRuns)
    .set({ status: "failed", error: "The run stopped without finishing.", finishedAt: new Date() })
    .where(and(eq(serverBackupRuns.status, "running"), lt(serverBackupRuns.startedAt, sql`now() - interval '12 hours'`)))
    .returning({ id: serverBackupRuns.id, jobId: serverBackupRuns.jobId })
  for (const s of stuck) {
    const [job] = await db.select().from(serverBackupJobs).where(eq(serverBackupJobs.id, s.jobId))
    if (job) await settle(job, "The run stopped without finishing.")
  }
  const [s] = await db.select({ on: settings.serverBackupEnabled, members: settings.serverBackupMembers }).from(settings)
  if (!s?.on) return 0
  const due = await db
    .select({ job: serverBackupJobs, admin: sql<boolean>`${user.role} in ('owner', 'admin')` })
    .from(serverBackupJobs)
    .innerJoin(serverBackupHosts, eq(serverBackupHosts.id, serverBackupJobs.hostId))
    .innerJoin(user, eq(user.id, serverBackupJobs.userId))
    .where(and(eq(serverBackupJobs.paused, false), eq(serverBackupHosts.mode, "ssh"), sql`${serverBackupJobs.nextDueAt} <= now()`))
  let n = 0
  for (const d of due) if ((s.members || d.admin) && (await startRun(d.job, "schedule")).started) n++
  return n
}

