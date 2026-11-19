// Git Backup alerts: bell + email (lib/notify.ts does both) after two failures in a row, and a week before a token expires.
import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { gitBackupConnections, gitBackupJobs } from "@/lib/db/schema"
import { notify } from "@/lib/notify"

// Claims the alert first, so a retry doesn't send it twice.
export async function alertFailing(job: typeof gitBackupJobs.$inferSelect, streak: number, error?: string) {
  const [claimed] = await db
    .update(gitBackupJobs)
    .set({ alertedAt: new Date() })
    .where(and(eq(gitBackupJobs.id, job.id), isNull(gitBackupJobs.alertedAt)))
    .returning({ id: gitBackupJobs.id })
  if (claimed) await notify(job.userId, "git_backup", { data: { event: "failed", job: job.name, streak: String(streak), error: error ?? "", href: `/more/github-backup?job=${job.id}&tab=history` } })
}

// Daily: tokens that expire within 7 days, once each.
export async function warnExpiring() {
  const due = await db
    .update(gitBackupConnections)
    .set({ warnedAt: new Date() })
    .where(and(isNull(gitBackupConnections.warnedAt), sql`${gitBackupConnections.expiresAt} <= now() + interval '7 days'`))
    .returning({ userId: gitBackupConnections.userId, name: gitBackupConnections.name, expiresAt: gitBackupConnections.expiresAt })
  for (const c of due) {
    const days = Math.max(Math.ceil((c.expiresAt!.getTime() - Date.now()) / 86_400_000), 0)
    await notify(c.userId, "git_backup", { data: { event: "expiring", name: c.name, days: String(days), href: "/more/github-backup?tab=settings" } })
  }
  return due.length
}
