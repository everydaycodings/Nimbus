// The minute tick (worker job "import-tick"): scheduled imports that are due get a run.
import "server-only"

import { and, eq, isNotNull, lt, lte, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { importJobs, importRuns, settings } from "@/lib/db/schema"
import { redis } from "@/lib/redis"
import { startRun } from "./runner"

export async function tick() {
  // A run whose app died without finishing; the worker normally closes these itself. A big import can take days, so be patient.
  const stuck = await db
    .update(importRuns)
    .set({ status: "failed", errors: ["The run didn't finish."], finishedAt: new Date() })
    .where(and(eq(importRuns.status, "running"), lt(importRuns.startedAt, sql`now() - interval '3 days'`)))
    .returning({ jobId: importRuns.jobId })
  for (const { jobId } of stuck) await redis.del(`import:progress:${jobId}`).catch(() => {})
  const [s] = await db.select({ on: settings.importToolEnabled }).from(settings)
  if (!s?.on) return 0
  const due = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.paused, false), isNotNull(importJobs.intervalMin), lte(importJobs.nextDueAt, new Date())))
  let n = 0
  for (const job of due) if ((await startRun(job, "schedule")).started) n++
  return n
}
