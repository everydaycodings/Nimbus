// Runs Admin → Health's checks on the interval the admin picked. It only keeps
// time: each job asks the app to run the probes (POST /api/health/run).
// Run: npm run worker
import { Worker } from "bullmq"
import postgres from "postgres"

import {
  HEALTH_QUEUE,
  HEARTBEAT_KEY,
  redis,
  scheduleHealth,
  workerConnection,
} from "../lib/redis.ts"
import { signToken } from "../lib/upload-rules.ts"

const app = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

// Saving a new interval in the admin panel reschedules too, so this only
// matters for the first start.
const sql = postgres(process.env.DATABASE_URL!)
const [{ minutes }] =
  await sql`select health_interval_min as minutes from settings`
await sql.end()
await scheduleHealth(minutes)
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
