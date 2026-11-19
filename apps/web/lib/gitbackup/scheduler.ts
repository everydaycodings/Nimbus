// The minute tick (worker job "git-backup-tick"): repos that are due, grouped by job, one run each; plus auto-include jobs that are due.
import "server-only"

import { and, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { redis } from "@/lib/redis"
import { gitBackupJobs, gitBackupRepos, gitBackupRuns, settings } from "@/lib/db/schema"
import { startRun, sweepUnpacked } from "./runner"

export async function tick() {
  // A run whose app died without finishing; the worker normally closes these itself.
  const stuck = await db
    .update(gitBackupRuns)
    .set({ status: "failed", finishedAt: new Date() })
    .where(and(eq(gitBackupRuns.status, "running"), lt(gitBackupRuns.startedAt, sql`now() - interval '12 hours'`)))
    .returning({ jobId: gitBackupRuns.jobId })
  for (const { jobId } of stuck) {
    await db
      .update(gitBackupJobs)
      .set({ lastStatus: "failed", lastRunAt: new Date(), failStreak: sql`${gitBackupJobs.failStreak} + 1` })
      .where(eq(gitBackupJobs.id, jobId))
    await redis.del(`gitbackup:progress:${jobId}`).catch(() => {})
  }
  await sweepUnpacked()
  const [s] = await db.select({ on: settings.gitBackupEnabled }).from(settings)
  if (!s?.on) return 0
  const due = await db
    .select({ job: gitBackupJobs, repoId: gitBackupRepos.id })
    .from(gitBackupRepos)
    .innerJoin(gitBackupJobs, eq(gitBackupJobs.id, gitBackupRepos.jobId))
    .where(and(eq(gitBackupJobs.paused, false), ne(gitBackupRepos.status, "gone"), lte(gitBackupRepos.nextDueAt, new Date())))
  const byJob = new Map<string, { job: typeof gitBackupJobs.$inferSelect; repoIds: string[] }>()
  for (const d of due) byJob.set(d.job.id, { job: d.job, repoIds: [...(byJob.get(d.job.id)?.repoIds ?? []), d.repoId] })
  // Jobs that auto-include new repos also run on their own interval, so one with no (due) repos still finds new ones.
  const auto = await db
    .select()
    .from(gitBackupJobs)
    .where(
      and(
        eq(gitBackupJobs.paused, false),
        sql`cardinality(${gitBackupJobs.autoOwners}) > 0`,
        or(isNull(gitBackupJobs.lastRunAt), sql`${gitBackupJobs.lastRunAt} + make_interval(mins => ${gitBackupJobs.intervalMin}) <= now()`)
      )
    )
  for (const job of auto) if (!byJob.has(job.id)) byJob.set(job.id, { job, repoIds: [] })
  let n = 0
  for (const { job, repoIds } of byJob.values()) if ((await startRun(job, { trigger: "schedule", repoIds })).started) n++
  return n
}
