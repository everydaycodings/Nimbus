import { Shell } from "@/components/server-backup/shell"
import { TABS, type Tab } from "@/components/server-backup/format"
import { listHosts } from "@/lib/server-backup/hosts"
import { listJobs, listRuns, listSnapshots } from "@/lib/server-backup/jobs"
import { isAdmin, requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Server backup · Nimbus" }

export default async function ServerBackupPage({ searchParams }: { searchParams: Promise<{ tab?: string; job?: string; view?: string; host?: string }> }) {
  const me = await requireMember()
  const s = await getSettings()
  const q = await searchParams
  const [jobs, hosts] = await Promise.all([listJobs(me.id), listHosts(me.id)])
  const job = jobs.find((j) => j.id === q.job) ?? jobs[0] ?? null
  const tab: Tab = TABS.some(([t]) => t === q.tab) ? (q.tab as Tab) : "overview"
  const [runs, snapshots] = job ? await Promise.all([tab === "history" ? listRuns(me.id, job.id) : [], tab === "snapshots" ? listSnapshots(me.id, job.id) : []]) : [[], []]
  return <Shell jobs={jobs} job={job} tab={tab} hosts={hosts} runs={runs} snapshots={snapshots} admin={isAdmin(me.role)} min={s.serverBackupMinInterval} view={q.view === "servers" ? "servers" : q.view === "new" ? "new" : null} host={q.host} />
}
