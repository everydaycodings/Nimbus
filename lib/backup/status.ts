// Where backups stand, for Admin → Backups and the Health check.
import "server-only"

import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import { isStale, KINDS, nextRun, type Kind, type Schedule } from "@/lib/backup-rules"
import { db } from "@/lib/db"
import { backupObjects, backupRuns } from "@/lib/db/schema"
import { BACKUP_HEARTBEAT_KEY, redis } from "@/lib/redis"
import type { Settings } from "@/lib/signup"
import { resolveDest, type Dest } from "./dest"

export const scheduleOf = (s: Settings, kind: Kind): Schedule => ({
  enabled: kind === "db" ? s.backupDbEnabled : s.backupFilesEnabled,
  intervalHours: kind === "db" ? s.backupDbIntervalH : s.backupFilesIntervalH,
  start: kind === "db" ? s.backupDbStart : s.backupFilesStart,
  tz: s.backupTz,
  paused: s.backupPaused,
})

export type Worker = { at: number; docker: boolean; key: boolean } | null

// The backup worker's last heartbeat, or null when it isn't running.
export async function backupWorker(): Promise<Worker> {
  try {
    const raw = await redis.get(BACKUP_HEARTBEAT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// The destination, or why it can't be used.
export function destOf(s: Settings): { dest: Dest | null; error: string | null } {
  try {
    return { dest: resolveDest(s), error: null }
  } catch (e) {
    return { dest: null, error: (e as Error).message }
  }
}

const GOOD = ["ok", "warning"] as const

async function lastOf(kind: Kind, good: boolean) {
  const [r] = await db
    .select()
    .from(backupRuns)
    .where(
      and(
        eq(backupRuns.kind, kind),
        ne(backupRuns.trigger, "reverify"),
        good
          ? inArray(backupRuns.status, [...GOOD])
          : ne(backupRuns.status, "skipped")
      )
    )
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
  return r ?? null
}

export async function backupStatus(s: Settings) {
  const now = new Date()
  const [worker, kinds, [stored], [mirror]] = await Promise.all([
    backupWorker(),
    Promise.all(
      KINDS.map(async (kind) => {
        const schedule = scheduleOf(s, kind)
        const [last, lastGood] = await Promise.all([lastOf(kind, false), lastOf(kind, true)])
        return {
          kind,
          schedule,
          last,
          lastGood,
          next: nextRun(schedule, now),
          stale: isStale(schedule, lastGood?.startedAt ?? null, now),
        }
      })
    ),
    // What the bucket holds: dumps still kept, and the file mirror.
    db
      .select({
        bytes: sql<number>`coalesce(sum(${backupRuns.sizeBytes}), 0)::float8`,
        n: sql<number>`count(*)::int`,
      })
      .from(backupRuns)
      .where(and(eq(backupRuns.kind, "db"), isNull(backupRuns.deletedAt), sql`${backupRuns.s3Key} is not null`, ne(backupRuns.trigger, "reverify"))),
    db
      .select({
        bytes: sql<number>`coalesce(sum(${backupObjects.size}), 0)::float8`,
        n: sql<number>`count(*)::int`,
      })
      .from(backupObjects),
  ])
  return {
    now: now.getTime(),
    ...destOf(s),
    worker,
    kinds,
    running: kinds.some((k) => k.last?.status === "running"),
    stored: { dumps: stored, mirror },
  }
}
