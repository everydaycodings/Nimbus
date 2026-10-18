// Redis: required. Holds the health-check schedule (BullMQ) and heartbeats.
// No `@/` imports and no server-only, so scripts/worker.ts and the indexer share it.
import { Queue } from "bullmq"
import { Redis } from "ioredis"

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

export const healthQueue =
  globalForRedis.healthQueue ?? new Queue(HEALTH_QUEUE, { connection: redis })
if (process.env.NODE_ENV !== "production")
  Object.assign(globalForRedis, { redis, healthQueue })

// Runs the checks every `minutes`, or stops the schedule when null.
export async function scheduleHealth(minutes: number | null) {
  if (minutes === null) await healthQueue.removeJobScheduler(HEALTH_QUEUE)
  else
    await healthQueue.upsertJobScheduler(HEALTH_QUEUE, {
      every: minutes * 60_000,
    })
}
