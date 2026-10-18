// Runs Admin → Health's checks on the interval the admin picked, and the
// background jobs the app queues (lib/redis.ts enqueue). For the health checks
// and most jobs it only keeps time and retries: the app does the work
// (POST /api/health/run, /api/jobs). The search indexer runs here, since
// reading text out of images is heavy.
// Run: npm run worker
import { Worker } from "bullmq"
import postgres from "postgres"

import {
  HEALTH_QUEUE,
  HEARTBEAT_KEY,
  INDEXER_KEY,
  JOBS_QUEUE,
  redis,
  scheduleHealth,
  scheduleJobs,
  workerConnection,
} from "../lib/redis.ts"
import { signToken } from "../lib/upload-rules.ts"
import { sweep } from "./indexer.ts"

const app = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

// Saving a new interval in the admin panel reschedules too, so this only
// matters for the first start.
const sql = postgres(process.env.DATABASE_URL!)
const [{ minutes }] =
  await sql`select health_interval_min as minutes from settings`
await sql.end()
await scheduleHealth(minutes)
await scheduleJobs()
console.log(
  minutes
    ? `Checking every ${minutes} min.`
    : "Scheduled checks are off. Waiting for an admin to turn them on."
)

const worker = new Worker(
  HEALTH_QUEUE,
  async () => {
    const res = await fetch(`${app}/api/health/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signToken("health", {}, 60_000)}`,
      },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`${app} answered ${res.status}.`)
    const { failed } = (await res.json()) as { failed: string[] }
    // Only after a run that landed, so the page's "stale" banner covers an unreachable app too.
    await redis.set(HEARTBEAT_KEY, Date.now())
    console.log(
      `${new Date().toISOString()} ${failed.length ? `failing: ${failed.join(", ")}` : "all good"}`
    )
  },
  { connection: workerConnection(), concurrency: 1 }
)
worker.on("failed", (_, e) =>
  console.error(`${new Date().toISOString()} run failed: ${e.message}`)
)

// A sweep longer than a minute meets the next one; that one waits on the first.
let sweeping: Promise<unknown> | undefined
async function index() {
  await (sweeping ??= sweep().finally(() => (sweeping = undefined)))
  // Admin → Health shows the indexer as running while this key lives.
  await redis.set(INDEXER_KEY, Date.now(), "PX", 3 * 60_000)
}

const jobs = new Worker(
  JOBS_QUEUE,
  async (job) => {
    if (job.name === "index") return index()
    const res = await fetch(`${app}/api/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signToken("job", {}, 60_000)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: job.name, data: job.data }),
      // Purging a big trash deletes a lot.
      signal: AbortSignal.timeout(5 * 60_000),
    })
    if (!res.ok)
      throw new Error(`${app} answered ${res.status}: ${await res.text()}`)
  },
  { connection: workerConnection(), concurrency: 4 }
)
jobs.on("failed", (job, e) =>
  console.error(
    `${new Date().toISOString()} ${job?.name} failed (try ${job?.attemptsMade}): ${e.message}`
  )
)
