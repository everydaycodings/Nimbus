// The worker's side of a backup run: its row in backup_runs, the settings it
// runs under, and what happens after a failure. lib/backup/run-db.ts and
// run-files.ts do the work. Relative imports only: plain node runs this.
import postgres from "postgres"

import { scrub, type Checks, type Kind, type Trigger } from "../backup-rules.ts"
import type { backupRuns, settings } from "../db/schema.ts"
import { enqueue, enqueueBackup } from "../redis.ts"
import { resolveDest } from "./dest.ts"
import { backupKey } from "./file-crypto.ts"

// Column names come back camelCase, as Drizzle names them.
export const sql = postgres(process.env.DATABASE_URL!, {
  // Column names only: postgres.camel would rename keys inside jsonb too.
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
  onnotice: () => {},
  // bigint as a number, like Drizzle's mode: "number". Byte counts stay far below 2^53.
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (x: number) => String(x),
      parse: (x: string) => Number(x),
    },
  },
})

export type Settings = typeof settings.$inferSelect
export type Run = typeof backupRuns.$inferSelect

export async function readSettings() {
  const [s] = await sql<Settings[]>`select * from settings`
  return s
}

export const getRun = async (id: string) =>
  (await sql<Run[]>`select * from backup_runs where id = ${id}`)[0] ?? null

// jsonb columns need sql.json; everything else goes as is.
export async function updateRun(id: string, patch: Partial<Run>) {
  const row = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [
      k,
      v && typeof v === "object" && !(v instanceof Date)
        ? sql.json(v as postgres.JSONValue)
        : v,
    ])
  )
  await sql`update backup_runs set ${sql(row)} where id = ${id}`
}

// A new running row, or null when one of this kind is already running (the
// attempt is recorded as skipped).
export async function openRun(
  kind: Kind,
  trigger: Trigger,
  o: { sourceRunId?: string; attempt?: number; actorId?: string } = {}
) {
  const row = {
    kind,
    trigger,
    sourceRunId: o.sourceRunId ?? null,
    attempt: o.attempt ?? 1,
    actorId: o.actorId ?? null,
  }
  try {
    const [r] = await sql<Run[]>`insert into backup_runs ${sql(row)} returning *`
    return r
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") throw e
    await sql`insert into backup_runs ${sql({
      ...row,
      status: "skipped",
      finishedAt: new Date(),
      error: "Another backup of this kind was still running.",
    })}`
    return null
  }
}

// A failure whose message is already fit to show.
export class StepError extends Error {}

export type Ctx = { run: Run; checks: Checks; step: string | null; t0: number }

export const log = (ctx: Ctx, message: string) =>
  console.log(
    `${new Date().toISOString()} [${ctx.run.kind} ${ctx.run.id.slice(0, 8)} +${((Date.now() - ctx.t0) / 1000).toFixed(1)}s] ${message}`
  )

export async function step(ctx: Ctx, next: string, patch: Partial<Run> = {}) {
  ctx.step = next
  log(ctx, `${next}…`)
  await updateRun(ctx.run.id, { ...patch, step: next, checks: ctx.checks })
}

// What every run needs before it starts. The key is required for dumps,
// and for files when they're encrypted.
export function setup(s: Settings, needKey: boolean) {
  const dest = resolveDest(s)
  if (!dest)
    throw new StepError(
      "Backup storage isn't set up. Add a bucket under Admin → Backups → Settings."
    )
  const key = backupKey()
  if (needKey && !key)
    throw new StepError(
      "BACKUP_ENCRYPTION_KEY isn't set where the backup worker runs."
    )
  return { dest, key }
}

// Tells the app to alert the admins; it checks which events they want.
export const alert = (runId: string, event: "failure" | "warning" | "stale") =>
  enqueue("backup-alert", { runId, event })

export async function finish(ctx: Ctx, status: "ok" | "warning", patch: Partial<Run> = {}) {
  await updateRun(ctx.run.id, {
    ...patch,
    status,
    step: null,
    checks: ctx.checks,
    finishedAt: new Date(),
  })
  log(ctx, `done: ${status}`)
  if (status === "warning") await alert(ctx.run.id, "warning")
}

// Marks the run failed, then retries it if attempts remain or alerts.
// Re-verify never retries.
export async function fail(ctx: Ctx, s: Settings, e: unknown) {
  const message =
    e instanceof StepError ? e.message : scrub(e instanceof Error ? e.message : String(e))
  await updateRun(ctx.run.id, {
    status: "failed",
    step: ctx.step,
    checks: ctx.checks,
    error: message,
    finishedAt: new Date(),
  })
  log(ctx, `FAILED during ${ctx.step ?? "start"}: ${message}`)
  const { run } = ctx
  if (run.trigger !== "reverify" && run.attempt <= s.backupRetryAttempts) {
    await enqueueBackup(
      {
        kind: run.kind,
        trigger: "retry",
        sourceRunId: run.sourceRunId ?? run.id,
        attempt: run.attempt + 1,
      },
      s.backupRetryDelayMin * 60_000
    )
    log(ctx, `retry ${run.attempt + 1} in ${s.backupRetryDelayMin} min`)
    return
  }
  await alert(run.id, "failure")
  await updateRun(run.id, { alertedAt: new Date() })
}
