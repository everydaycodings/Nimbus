// Runs Admin → Backups: database dumps (verified in a throwaway Postgres
// before upload) and the file mirror, on the admin's schedules and on demand.
// Needs Docker on this machine for pg_dump and the scratch database.
// Run: npm run worker:backup
import { Worker } from "bullmq"

import { isStale, type Kind } from "../lib/backup-rules.ts"
import { dockerAvailable, removeOrphanScratch } from "../lib/backup/pg.ts"
import { backupDb, reverifyDb } from "../lib/backup/run-db.ts"
import { backupFiles } from "../lib/backup/run-files.ts"
import { alert, getRun, openRun, readSettings, sql, type Settings } from "../lib/backup/runs.ts"
import {
  BACKUP_HEARTBEAT_KEY,
  BACKUPS_QUEUE,
  redis,
  scheduleBackups,
  workerConnection,
  type BackupJob,
} from "../lib/redis.ts"

const docker = await dockerAvailable()
const key = Boolean(process.env.BACKUP_ENCRYPTION_KEY)
if (!docker) console.warn("Docker isn't reachable: database backups will fail until it is.")
if (!key) console.warn("BACKUP_ENCRYPTION_KEY isn't set: database backups will fail until it is.")

// A run still "running" here belonged to a worker that stopped mid-way.
const stopped = await sql`
  update backup_runs set status = 'failed', step = null, finished_at = now(),
    error = 'The backup worker stopped during this run.'
  where status = 'running' returning id`
const orphans = await removeOrphanScratch().catch(() => 0)
if (stopped.length || orphans)
  console.log(`Closed ${stopped.length} interrupted run(s), removed ${orphans} scratch container(s).`)

const schedule = (s: Settings, kind: Kind) => ({
  enabled: kind === "db" ? s.backupDbEnabled : s.backupFilesEnabled,
  intervalHours: kind === "db" ? s.backupDbIntervalH : s.backupFilesIntervalH,
  start: kind === "db" ? s.backupDbStart : s.backupFilesStart,
  tz: s.backupTz,
  paused: s.backupPaused,
})

// Saving settings reschedules too; this catches a change made while Redis
// was away. Then the stale alert, once per stretch without a good backup.
async function tick() {
  const s = await readSettings()
  await scheduleBackups(s)
  for (const kind of ["db", "files"] as const) {
    const [last] = await sql<{ id: string; startedAt: Date }[]>`
      select id, started_at from backup_runs
      where kind = ${kind} and status in ('ok', 'warning') and trigger <> 'reverify'
      order by started_at desc limit 1`
    if (!last || !isStale(schedule(s, kind), last.startedAt, new Date())) continue
    const sent = `backups:stale:${kind}`
    if ((await redis.get(sent)) === last.id) continue
    await alert(last.id, "stale")
    await redis.set(sent, last.id)
  }
}
await tick()
setInterval(() => tick().catch((e) => console.error("backup tick:", e.message)), 5 * 60_000)

// Admin → Backups shows the worker as up while this key lives, and what it's missing.
const beat = () =>
  redis
    .set(BACKUP_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), docker, key }), "PX", 3 * 60_000)
    .catch(() => {})
await beat()
setInterval(beat, 60_000)

// Two at a time, so a long file mirror doesn't hold up a dump. backup_runs
// allows one running run per kind.
const worker = new Worker<BackupJob>(
  BACKUPS_QUEUE,
  async (job) => {
    const { kind, trigger, runId, sourceRunId, attempt } = job.data
    const run = runId ? await getRun(runId) : await openRun(kind, trigger, { sourceRunId, attempt })
    // Already closed, or another of this kind is running (recorded as skipped).
    if (run?.status !== "running") return
    if (run.kind === "files") await backupFiles(run)
    else if (run.trigger === "reverify") await reverifyDb(run)
    else await backupDb(run)
  },
  { connection: workerConnection(), concurrency: 2, lockDuration: 5 * 60_000 }
)
worker.on("failed", (job, e) => console.error(`${new Date().toISOString()} ${job?.name} crashed: ${e.message}`))
console.log("Backup worker ready.")
