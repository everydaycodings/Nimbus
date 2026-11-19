import { count, desc, eq } from "drizzle-orm"

import { AdminPage, Section } from "@/components/admin/setting"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos, user } from "@/lib/db/schema"

export const metadata = { title: "Git Backup jobs · Admin · Nimbus" }
export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const every = (m: number) => (m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`)

export default async function GitBackupJobsAdminPage() {
  const repoCount = db
    .select({ jobId: gitBackupRepos.jobId, n: count().as("n") })
    .from(gitBackupRepos)
    .groupBy(gitBackupRepos.jobId)
    .as("rc")
  const jobs = await db
    .select({ j: gitBackupJobs, owner: user.name, email: user.email, repos: repoCount.n })
    .from(gitBackupJobs)
    .innerJoin(user, eq(user.id, gitBackupJobs.userId))
    .leftJoin(repoCount, eq(repoCount.jobId, gitBackupJobs.id))
    .orderBy(desc(gitBackupJobs.createdAt))

  return (
    <AdminPage
      title="Git Backup jobs"
      description="Every member's jobs, read-only."
      back={{ href: "/admin/system/more-tools", label: "More tools" }}
    >
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
          No one has set up a backup job yet.
        </p>
      ) : (
        <Section>
          <ul className="flex flex-col divide-y">
            {jobs.map(({ j, owner, email, repos }) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate" title={j.name}>{j.name}</span>
                    {j.paused && <Badge variant="secondary">Paused</Badge>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground" title={`${owner} · ${email}`}>
                    {owner} · {email}
                  </p>
                </div>
                <p className="basis-56 text-sm text-muted-foreground tabular-nums">
                  {repos === 1 ? "1 repo" : `${repos ?? 0} repos`} · {j.destKind === "nimbus" ? "Nimbus S3" : "External S3"} ·
                  every {every(j.intervalMin)}
                </p>
                <p className="basis-56 text-sm text-muted-foreground tabular-nums">
                  {j.lastRunAt ? `Ran ${when.format(j.lastRunAt)}` : "Never ran"}
                  {j.lastStatus && j.lastStatus !== "failed" && (
                    <>
                      {" · "}
                      <Badge variant="outline">{j.lastStatus === "ok" ? "OK" : "Partial"}</Badge>
                    </>
                  )}
                  {j.failStreak > 0 && ` · ${j.failStreak} failed in a row`}
                  {j.lastStatus === "failed" && (
                    <span className="ml-2 inline-flex items-center gap-1.5 text-foreground">
                      <span aria-hidden className="size-2 rounded-full bg-destructive" />
                      Last run failed
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </AdminPage>
  )
}
