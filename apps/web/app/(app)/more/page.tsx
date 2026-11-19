import { count, eq, max, sql } from "drizzle-orm"
import { notFound } from "next/navigation"

import { ToolCard, type ToolStatus } from "@/components/more/tool-card"
import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos } from "@/lib/db/schema"
import { moreTools } from "@/lib/more-tools"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "More · Nimbus" }
export const dynamic = "force-dynamic"

async function gitBackupStatus(userId: string): Promise<ToolStatus> {
  const [[j], [r]] = await Promise.all([
    db
      .select({
        jobs: count(),
        last: max(gitBackupJobs.lastRunAt),
        failed: sql<number>`count(*) filter (where ${gitBackupJobs.lastStatus} = 'failed')`.mapWith(Number),
      })
      .from(gitBackupJobs)
      .where(eq(gitBackupJobs.userId, userId)),
    db
      .select({ n: count() })
      .from(gitBackupRepos)
      .innerJoin(gitBackupJobs, eq(gitBackupRepos.jobId, gitBackupJobs.id))
      .where(eq(gitBackupJobs.userId, userId)),
  ])
  return { jobs: j.jobs, repos: r.n, lastRunAt: j.last?.toISOString() ?? null, failed: j.failed > 0 }
}

export default async function MorePage() {
  const me = await requireMember()
  const tools = moreTools(await getSettings())
  if (tools.length === 0) notFound()
  const now = Date.now()
  // ponytail: every tool shares the Git Backup status until a second tool exists.
  const cards = await Promise.all(tools.map(async (t) => ({ t, status: await gitBackupStatus(me.id) })))
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">More</h1>
        <p className="text-sm text-pretty text-muted-foreground">Extra tools that run alongside your files.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ t, status }) => (
          <ToolCard key={t.id} tool={t} status={status} now={now} />
        ))}
      </div>
    </div>
  )
}
