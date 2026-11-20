import { CloudArrowDownIcon } from "@phosphor-icons/react/dist/ssr"

import { Empty } from "@/components/empty-state"
import { TABS, type Tab } from "@/components/import/format"
import { Shell } from "@/components/import/shell"
import { listConnections, oauthReady } from "@/lib/import/connections"
import { listItems, listJobs, listRuns } from "@/lib/import/jobs"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Cloud import · Nimbus" }

type Q = { tab?: string; job?: string; new?: string; view?: string; connected?: string; oauth_error?: string; detail?: string; status?: string; q?: string; p?: string }

export default async function ImportPage({ searchParams }: { searchParams: Promise<Q> }) {
  const me = await requireMember()
  const s = await getSettings()
  if (!s.importToolEnabled)
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cloud import</h1>
        <Empty icon={CloudArrowDownIcon} title="Cloud import is turned off">An admin turned it off on this server. Your imports and the files they brought over are kept.</Empty>
      </div>
    )
  const q = await searchParams
  const [jobs, connections] = await Promise.all([listJobs(me.id), listConnections(me.id)])
  const job = jobs.find((j) => j.id === q.job) ?? jobs[0] ?? null
  const tab: Tab = TABS.some(([t]) => t === q.tab) ? (q.tab as Tab) : "overview"
  const page = Math.max(0, Math.floor(Number(q.p) || 0))
  const status = q.status ?? ""
  const [runs, items] = job
    ? await Promise.all([tab === "history" ? listRuns(me.id, job.id) : [], tab === "items" ? listItems(me.id, job.id, { status, q: q.q, page }) : null])
    : [[], null]
  return (
    <Shell
      jobs={jobs}
      job={job}
      tab={tab}
      view={q.view === "connections" ? "connections" : "jobs"}
      runs={runs}
      items={items && { data: items, status, q: q.q ?? "", page }}
      connections={connections}
      oauth={oauthReady(s)}
      wizard={Boolean(q.new || q.connected)}
      connected={q.connected}
      oauthError={q.oauth_error}
      oauthDetail={q.detail}
    />
  )
}
