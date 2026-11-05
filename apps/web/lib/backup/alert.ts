// The backup worker's alerts, sent from the app (POST /api/jobs) so they
// reuse the bell and email. Admin → Backups picks which events alert at all;
// each admin's Account settings pick bell and email.
import "server-only"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { backupRuns } from "@/lib/db/schema"
import { admins } from "@/lib/health"
import { notify } from "@/lib/notify"
import { getSettings } from "@/lib/signup"

export async function backupAlert({
  runId,
  event,
}: {
  runId: string
  event: "failure" | "warning" | "stale"
}) {
  const s = await getSettings()
  if (!s.backupAlerts.includes(event)) return
  const [run] = await db
    .select({ kind: backupRuns.kind })
    .from(backupRuns)
    .where(eq(backupRuns.id, runId))
  if (!run) return
  for (const { id } of await admins())
    await notify(id, "backup", {
      data: { backup: run.kind, event, run: runId },
    })
}
