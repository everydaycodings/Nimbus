// Redis: required. Holds the BullMQ queues (health checks, background jobs) and heartbeats.
// No `@/` imports and no server-only, so scripts/worker.ts and the indexer share it.
import { Queue } from "bullmq"
import { Redis } from "ioredis"

import { toCron, type Kind, type Trigger } from "./backup-rules.ts"

const url = process.env.REDIS_URL
if (!url)
  throw new Error(
    "REDIS_URL is not set. Nimbus needs Redis; local_server/compose.yml runs one on port 6380."
  )

// Fails fast instead of queueing commands while Redis is away, so a page that
// reads a heartbeat doesn't hang (BullMQ recommends this for producers too).
const globalForRedis = globalThis as unknown as {
  redis?: Redis
  healthQueue?: Queue
  jobsQueue?: Queue
  backupsQueue?: Queue
}
export const redis =
  globalForRedis.redis ??
  new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
// ioredis logs every failed reconnect as an unhandled error otherwise.
redis.on("error", () => {})

// The worker's connection: BullMQ workers must retry forever.
export const workerConnection = () =>
  new Redis(url, { maxRetriesPerRequest: null })

export const HEALTH_QUEUE = "health"
export const HEARTBEAT_KEY = "health:heartbeat"
export const INDEXER_KEY = "health:indexer"
export const JOBS_QUEUE = "jobs"
export const BACKUPS_QUEUE = "backups"
// Set by npm run worker:backup while it's up.
export const BACKUP_HEARTBEAT_KEY = "backups:heartbeat"

export const healthQueue =
  globalForRedis.healthQueue ?? new Queue(HEALTH_QUEUE, { connection: redis })
export const jobsQueue =
  globalForRedis.jobsQueue ?? new Queue(JOBS_QUEUE, { connection: redis })
export const backupsQueue =
  globalForRedis.backupsQueue ?? new Queue(BACKUPS_QUEUE, { connection: redis })
if (process.env.NODE_ENV !== "production")
  Object.assign(globalForRedis, { redis, healthQueue, jobsQueue, backupsQueue })

// Runs the checks every `minutes`, or stops the schedule when null.
export async function scheduleHealth(minutes: number | null) {
  if (minutes === null) await healthQueue.removeJobScheduler(HEALTH_QUEUE)
  else
    await healthQueue.upsertJobScheduler(
      HEALTH_QUEUE,
      { every: minutes * 60_000 },
      { opts: { removeOnComplete: true, removeOnFail: 50 } }
    )
}

export type JobName = "email" | "delete-keys" | "tus-finish" | "backup-alert"

// Work the request shouldn't wait for, retried by `npm run worker` until it lands.
// Failed jobs stay a week for a look; done ones go, since emails carry file names.
export async function enqueue(name: JobName, data: object) {
  await jobsQueue.add(name, data, {
    attempts: 8,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600 },
  })
}

// Trash and old link events hourly; the indexer sweeps every minute.
export async function scheduleJobs() {
  const opts = { removeOnComplete: true, removeOnFail: 50 }
  await jobsQueue.upsertJobScheduler(
    "purge",
    { every: 3600_000 },
    { name: "purge", opts }
  )
  await jobsQueue.upsertJobScheduler(
    "index",
    { every: 60_000 },
    { name: "index", opts }
  )
}

// A backup for npm run worker:backup. `runId`: a row the app already opened
// (Back up now); otherwise the worker opens one.
export type BackupJob = {
  kind: Kind
  trigger: Trigger
  runId?: string
  sourceRunId?: string
  attempt?: number
}

// Never retried by BullMQ: a failed run schedules its own retry, as a new run.
export async function enqueueBackup(job: BackupJob, delayMs = 0) {
  await backupsQueue.add(job.kind, job, {
    delay: delayMs,
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 50,
  })
}

// Each kind on its own schedule in the admin's zone, or none when off/paused.
export async function scheduleBackups(s: {
  backupPaused: boolean
  backupTz: string
  backupDbEnabled: boolean
  backupDbIntervalH: number
  backupDbStart: string
  backupFilesEnabled: boolean
  backupFilesIntervalH: number
  backupFilesStart: string
}) {
  const plan = {
    db: [s.backupDbEnabled, s.backupDbIntervalH, s.backupDbStart],
    files: [s.backupFilesEnabled, s.backupFilesIntervalH, s.backupFilesStart],
  } as const
  for (const kind of ["db", "files"] as const) {
    const [on, hours, start] = plan[kind]
    const id = `backup-${kind}`
    if (!on || s.backupPaused) await backupsQueue.removeJobScheduler(id)
    else
      await backupsQueue.upsertJobScheduler(
        id,
        { pattern: toCron(hours, start), tz: s.backupTz },
        {
          name: kind,
          data: { kind, trigger: "schedule" } satisfies BackupJob,
          opts: { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
        }
      )
  }
}
