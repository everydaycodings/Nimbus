import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr"

import { Empty } from "@/components/empty-state"
import { TABS, type Tab } from "@/components/gitbackup/format"
import { Shell } from "@/components/gitbackup/shell"
import { listConnections, listRegistryConnections } from "@/lib/gitbackup/connections"
import { listJobs, listRepos, listRuns } from "@/lib/gitbackup/jobs"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Git Backup · Nimbus" }

export default async function GitBackupPage({ searchParams }: { searchParams: Promise<{ tab?: string; job?: string; new?: string; connected?: string; oauth_error?: string }> }) {
  const me = await requireMember()
  const s = await getSettings()
  if (!s.gitBackupEnabled)
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Git Backup</h1>
        <Empty icon={GithubLogoIcon} title="Git Backup is turned off">An admin turned it off on this server. Your jobs and backups are kept.</Empty>
      </div>
    )
  const q = await searchParams
  const [jobs, connections, registry] = await Promise.all([listJobs(me.id), listConnections(me.id), listRegistryConnections(me.id).catch(() => [])])
  const job = jobs.find((j) => j.id === q.job) ?? jobs[0] ?? null
  const tab: Tab = TABS.some(([t]) => t === q.tab) ? (q.tab as Tab) : "overview"
  const [repos, runs] = job
    ? await Promise.all([tab === "repos" || tab === "history" ? listRepos(me.id, job.id) : [], tab === "history" ? listRuns(me.id, job.id) : []])
    : [[], []]
  return (
    <Shell
      jobs={jobs}
      job={job}
      tab={tab}
      repos={repos}
      runs={runs}
      connections={connections}
      registry={registry}
      oauth={Boolean(s.githubOauthClientId && s.githubOauthClientSecret)}
      min={s.gitBackupMinInterval}
      wizard={Boolean(q.new || q.connected)}
      connected={q.connected}
      oauthError={q.oauth_error}
    />
  )
}
