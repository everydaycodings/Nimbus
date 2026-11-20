"use client"

import { PlugsConnectedIcon, PlusIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId } from "react"

import { SELECT, TOUCH } from "@/components/registry-ui"
import { buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { ConnView } from "@/lib/import/connections"
import type { ItemsPage, JobView, RunView } from "@/lib/import/jobs"
import { cn } from "@/lib/utils"
import type { Ready } from "./add-connection"
import { ConnectionsManager } from "./connections-manager"
import { TABS, type Tab } from "./format"
import { History } from "./history"
import { Items } from "./items"
import { Overview } from "./overview"
import { Settings } from "./settings"
import { useProgress } from "./use-progress"
import { Wizard } from "./wizard"

const OAUTH_ERRORS: Record<string, string> = {
  off: "Connecting that service isn't set up on this server. Paste a token instead.",
  state: "That sign-in expired or came from another browser. Try Connect again.",
  denied: "The service didn't give access. Nothing was saved.",
  exchange: "The service didn't accept the sign-in. Try again, and allow offline access when asked.",
  save: "Couldn't save the connection.",
}
const BASE = "/more/import"

export function Shell({ jobs, job, tab, view, runs, items, connections, oauth, wizard, connected, oauthError, oauthDetail }: {
  jobs: JobView[]
  job: JobView | null
  tab: Tab
  view: "jobs" | "connections"
  runs: RunView[]
  items: { data: ItemsPage; status: string; q: string; page: number } | null
  connections: ConnView[]
  oauth: Ready
  wizard: boolean
  connected?: string
  oauthError?: string
  oauthDetail?: string
}) {
  const router = useRouter()
  const id = useId()
  const showWizard = view === "jobs" && (wizard || !job)
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="mr-auto grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cloud import</h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">Bring your files over from Google Drive and Photos, Dropbox, OneDrive, S3, WebDAV, SFTP or a Google Takeout. Dates and folders come along, and nothing in Nimbus is ever deleted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "jobs" && job && !showWizard && jobs.length > 1 && (
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-job`} className="text-muted-foreground">Import</Label>
              <select id={`${id}-job`} value={job.id} onChange={(e) => router.push(`${BASE}?job=${e.target.value}${tab === "overview" ? "" : `&tab=${tab}`}`)} className={cn(SELECT, "max-w-52 pointer-coarse:h-11")}>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.name}</option>
                ))}
              </select>
            </div>
          )}
          {view === "jobs" ? (
            <Link href={`${BASE}?view=connections`} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>
              <PlugsConnectedIcon />
              Connections
            </Link>
          ) : (
            <Link href={BASE} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>Imports</Link>
          )}
          {view === "jobs" && job && !showWizard && (
            <Link href={`${BASE}?new=1`} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>
              <PlusIcon />
              New import
            </Link>
          )}
        </div>
      </header>

      {oauthError && (
        <p role="alert" className="rounded-lg border px-3 py-2.5 text-sm text-pretty text-destructive">
          {OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.save}
          {oauthError === "save" && oauthDetail ? ` ${oauthDetail}` : ""}
        </p>
      )}

      {view === "connections" ? (
        <ConnectionsManager connections={connections} oauth={oauth} adding={connected !== undefined ? false : undefined} />
      ) : showWizard ? (
        <Wizard connections={connections} oauth={oauth} connected={connected} intro={!job} onCancel={job ? () => router.push(`${BASE}?job=${job.id}`) : undefined} />
      ) : (
        job && <JobPanel job={job} tab={tab} runs={runs} items={items} />
      )}
    </div>
  )
}

function JobPanel({ job, tab, runs, items }: { job: JobView; tab: Tab; runs: RunView[]; items: { data: ItemsPage; status: string; q: string; page: number } | null }) {
  const { progress, kick } = useProgress(job.id)
  return (
    <>
      <nav role="tablist" aria-label="Import sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
        {TABS.map(([t, text]) => (
          <Link
            key={t}
            href={`${BASE}?job=${job.id}${t === "overview" ? "" : `&tab=${t}`}`}
            role="tab"
            aria-selected={tab === t}
            aria-current={tab === t ? "page" : undefined}
            className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
          >
            {text}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview job={job} progress={progress} kick={kick} />}
      {tab === "items" && items && <Items jobId={job.id} data={items.data} status={items.status} q={items.q} page={items.page} />}
      {tab === "history" && <History runs={runs} />}
      {tab === "settings" && <Settings key={job.id} job={job} />}
    </>
  )
}
