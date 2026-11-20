"use client"

import { PlusIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId } from "react"

import { SELECT, TOUCH } from "@/components/registry-ui"
import { buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { HostView } from "@/lib/server-backup/hosts"
import type { JobView, RunView, SnapshotView } from "@/lib/server-backup/jobs"
import { cn } from "@/lib/utils"
import { BASE, TABS, type Tab } from "./format"
import { History } from "./history"
import { HostsManager } from "./hosts"
import { Overview } from "./overview"
import { Settings } from "./settings"
import { Snapshots } from "./snapshots"
import { useProgress } from "./use-progress"
import { usable, Wizard } from "./wizard"

type Props = { jobs: JobView[]; job: JobView | null; tab: Tab; hosts: HostView[]; runs: RunView[]; snapshots: SnapshotView[]; admin: boolean; min: number; view: "servers" | "new" | null; host?: string }

export function Shell({ jobs, job, tab, hosts, runs, snapshots, admin, min, view, host }: Props) {
  const router = useRouter()
  const id = useId()
  // Nothing to show yet: servers first, then the wizard.
  const mode = view ?? (job ? null : hosts.some(usable) ? "new" : "servers")
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="mr-auto grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Server backup</h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">Back up folders and Docker volumes from your servers into an encrypted, deduplicated restic repository in S3 storage, and restore them whenever you need.</p>
        </div>
        {job && mode === null && (
          <div className="flex flex-wrap items-center gap-2">
            {jobs.length > 1 && (
              <div className="flex items-center gap-2">
                <Label htmlFor={`${id}-job`} className="text-muted-foreground">Job</Label>
                <select id={`${id}-job`} value={job.id} onChange={(e) => router.push(`${BASE}?job=${e.target.value}${tab === "overview" ? "" : `&tab=${tab}`}`)} className={cn(SELECT, "max-w-52 pointer-coarse:h-11")}>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
            )}
            <Link href={`${BASE}?view=servers`} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>Servers</Link>
            <Link href={`${BASE}?view=new`} className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>
              <PlusIcon />
              New job
            </Link>
          </div>
        )}
      </header>
      {mode === "servers" ? (
        <>
          <HostsManager hosts={hosts} admin={admin} intro={!job} />
          {job && <Link href={`${BASE}?job=${job.id}`} className="w-fit rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Back to {job.name}</Link>}
          {!job && hosts.some(usable) && <Link href={`${BASE}?view=new`} className={cn(buttonVariants(), TOUCH, "w-fit")}>Make a backup job</Link>}
        </>
      ) : mode === "new" ? (
        <Wizard hosts={hosts} admin={admin} min={min} preselect={host} onCancel={job ? () => router.push(`${BASE}?job=${job.id}`) : undefined} />
      ) : (
        job && <JobPanel job={job} tab={tab} hosts={hosts} runs={runs} snapshots={snapshots} min={min} />
      )}
    </div>
  )
}

function JobPanel({ job, tab, hosts, runs, snapshots, min }: { job: JobView; tab: Tab; hosts: HostView[]; runs: RunView[]; snapshots: SnapshotView[]; min: number }) {
  const { run, kick } = useProgress(job.id)
  const host = hosts.find((h) => h.id === job.hostId)
  return (
    <>
      <nav role="tablist" aria-label="Server backup sections" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
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
      {tab === "overview" && <Overview job={job} run={run} kick={kick} />}
      {tab === "snapshots" && <Snapshots job={job} snapshots={snapshots} />}
      {tab === "history" && <History runs={runs} />}
      {tab === "settings" && host && <Settings key={job.id} job={job} host={host} min={min} />}
    </>
  )
}
