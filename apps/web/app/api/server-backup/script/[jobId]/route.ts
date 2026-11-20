import { eq, and } from "drizzle-orm"

import { db } from "@/lib/db"
import { serverBackupHosts, serverBackupJobs } from "@/lib/db/schema"
import { agentScript } from "@/lib/server-backup/agent"
import { memberOrNull } from "@/lib/session"
import { allowed } from "@/lib/server-backup/access"
import { getSettings } from "@/lib/signup"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// nimbus-agent.sh for one of the member's push-agent jobs.
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const me = await memberOrNull()
  const s = await getSettings()
  if (!me || !allowed(s, me.role)) return new Response("Not found", { status: 404 })
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return new Response("Not found", { status: 404 })
  const [row] = await db
    .select({ id: serverBackupJobs.id, name: serverBackupJobs.name })
    .from(serverBackupJobs)
    .innerJoin(serverBackupHosts, eq(serverBackupHosts.id, serverBackupJobs.hostId))
    .where(and(eq(serverBackupJobs.id, jobId), eq(serverBackupJobs.userId, me.id), eq(serverBackupHosts.mode, "agent")))
  if (!row) return new Response("Not found", { status: 404 })
  return new Response(agentScript(row), { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Content-Disposition": 'attachment; filename="nimbus-agent.sh"', "Cache-Control": "no-store" } })
}
