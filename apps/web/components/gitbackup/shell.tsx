"use client"

import { PlusIcon, WarningIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId } from "react"

import { ExpiryBadge } from "@/components/registry-connections"
import { SELECT, TOUCH } from "@/components/registry-ui"
import { buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { expiryOf } from "@/lib/registry/connection-rules"
import type { ConnView, Ref, RegistryPick } from "@/lib/gitbackup/connections"
import type { JobView, RepoView, RunView } from "@/lib/gitbackup/jobs"
import { cn } from "@/lib/utils"
import { TABS, type Tab } from "./format"
import { History } from "./history"
import { Overview } from "./overview"
import { ReposTab } from "./repos-tab"
import { Settings } from "./settings"
import { useProgress } from "./use-progress"
import { Wizard } from "./wizard"


const OAUTH_ERRORS: Record<string, string> = {
  off: "Connect GitHub isn't set up on this server.",
  state: "That sign-in expired or came from another browser. Try Connect GitHub again.",
  denied: "GitHub didn't give access. Nothing was saved.",
  exchange: "GitHub didn't accept the sign-in. Try again.",
  save: "Couldn't save the connection. Try again.",
}
const BASE = "/more/github-backup"

export function Shell({ jobs, job, tab, repos, runs, connections, registry, oauth, min, wizard, connected, oauthError }: {
  jobs: JobView[]
  job: JobView | null
  tab: Tab
  repos: RepoView[]
  runs: RunView[]
  connections: ConnView[]
  registry: RegistryPick[]
  oauth: boolean
  min: number
  wizard: boolean
  connected?: string
  oauthError?: string
}) {
  const router = useRouter()
  const id = useId()
  const showWizard = wizard || !job
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="mr-auto grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Git Backup</h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">Keep full copies of your repos from GitHub, GitLab, Gitea or Forgejo, with every branch and tag, in S3 storage. A new snapshot is made only when something changed.</p>
        </div>
        {job && !showWizard && (
          <div className="flex flex-wrap items-center gap-2">
            {jobs.length > 1 && (
              <div className="flex items-center gap-2">
                <Label htmlFor={`${id}-job`} className="text-muted-foreground">Job</Label>
                <select id={`${id}-job`} value={job.id} onChange={(e) => router.push(`${BASE}?job=${e.target.value}${tab === "overview" ? "" : `&tab=${tab}`}`)} className={cn(SELECT, "max-w-52 pointer-coarse:h-11")}>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Link href={`${BASE}?new=1`} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>
              <PlusIcon />
              New job
            </Link>
          </div>
        )}
      </header>

      {oauthError && (
        <p role="alert" className="rounded-lg border px-3 py-2.5 text-sm text-pretty text-destructive">{OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.save}</p>
      )}

      {showWizard ? (
        <Wizard connections={connections} registry={registry} oauth={oauth} min={min} connected={connected} intro={!job} onCancel={job ? () => router.push(`${BASE}?job=${job.id}`) : undefined} />
      ) : (
        job && <JobPanel job={job} tab={tab} repos={repos} runs={runs} connections={connections} registry={registry} oauth={oauth} min={min} />
      )}
    </div>
  )
}

function JobPanel({ job, tab, repos, runs, connections, registry, oauth, min }: { job: JobView; tab: Tab; repos: RepoView[]; runs: RunView[]; connections: ConnView[]; registry: RegistryPick[]; oauth: boolean; min: number }) {
  const { progress, kick } = useProgress(job.id)
  const ref: Ref = job.connection.kind === "own" ? { connectionId: job.connection.id } : { registryConnectionId: job.connection.id }
  const e = expiryOf(job.connection.expiresAt ? new Date(job.connection.expiresAt) : null)
  return (
    <>
      <nav role="tablist" aria-label="Git Backup sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
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
      {(e.state === "soon" || e.state === "expired") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card p-3 text-sm">
          <WarningIcon aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="text-pretty">The token “{job.connection.name}” {e.state === "expired" ? "has expired" : "is about to expire"}, and backups stop when it does.</span>
          <ExpiryBadge at={job.connection.expiresAt} />
          {job.connection.kind === "own" && (
            <Link href={`${BASE}?job=${job.id}&tab=settings`} className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Replace it
            </Link>
          )}
        </div>
      )}
      {tab === "overview" && <Overview job={job} progress={progress} kick={kick} />}
      {tab === "repos" && <ReposTab job={job} repos={repos} connection={ref} progress={progress} kick={kick} />}
      {tab === "history" && <History runs={runs} repos={repos} />}
      {tab === "settings" && <Settings key={job.id} job={job} connections={connections} registry={registry} oauth={oauth} min={min} />}
    </>
  )
}
