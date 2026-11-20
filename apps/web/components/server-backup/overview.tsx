"use client"

import { CheckCircleIcon, CircleNotchIcon, DownloadSimpleIcon, PauseIcon, PlayIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { backupNow, setPaused } from "@/app/(app)/more/server-backup/actions"
import { Code, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button, buttonVariants } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-rules"
import type { JobView, RunView } from "@/lib/server-backup/jobs"
import { cn } from "@/lib/utils"
import { ago, every } from "./format"

type Look = { Icon: typeof CheckCircleIcon; title: string; line: string; tone: string }

function look(job: JobView, running: boolean): Look {
  if (running) return { Icon: CircleNotchIcon, title: "Backing up now", line: "Progress is shown below.", tone: "text-foreground" }
  if (job.paused) return { Icon: PauseIcon, title: "Paused", line: "Nothing is backed up until you resume.", tone: "text-muted-foreground" }
  if (job.lastStatus === "failed") return { Icon: WarningCircleIcon, title: "The last backup failed", line: `${job.failStreak > 1 ? `${job.failStreak} runs in a row failed. ` : ""}${job.lastError ?? "Open History to see why."}`, tone: "text-destructive" }
  if (!job.lastRunAt) return { Icon: CircleNotchIcon, title: job.hostMode === "agent" ? "Waiting for the agent" : "Waiting for the first backup", line: job.hostMode === "agent" ? "Run nimbus-agent.sh on the server." : "It starts as soon as the worker picks it up.", tone: "text-muted-foreground" }
  return { Icon: CheckCircleIcon, title: "Everything is backed up", line: `Last backup ${ago(job.lastRunAt)}.${job.hostMode === "agent" ? "" : ` Next ${ago(job.nextDueAt, "when due")}.`}`, tone: "text-brand" }
}

function Strip({ job, running }: { job: JobView; running: boolean }) {
  const { Icon, title, line, tone } = look(job, running)
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon aria-hidden className={cn("size-5", tone, running && "animate-spin motion-reduce:animate-none")} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-pretty text-muted-foreground" suppressHydrationWarning>{line}</p>
      </div>
    </div>
  )
}

function Live({ run }: { run: RunView }) {
  const pct = run.progress === null ? null : Math.round(Math.min(1, Math.max(0, run.progress)) * 100)
  return (
    <section aria-label="Backup progress" className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">{run.stage}</h2>
        <span className="text-xs text-muted-foreground" suppressHydrationWarning>Started {WHEN.format(new Date(run.startedAt))}</span>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {run.bytes ? formatBytes(run.bytes) : ""}{run.bytes && run.files ? " · " : ""}{run.files ? `${run.files.toLocaleString()} files` : ""}{pct !== null ? ` · ${pct}%` : ""}
        </span>
      </div>
      <div role="progressbar" aria-label="Backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full bg-primary", pct === null ? "w-1/3 animate-pulse motion-reduce:animate-none" : "transition-[width] motion-reduce:transition-none")} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
    </section>
  )
}

export function Overview({ job, run, kick }: { job: JobView; run: RunView | null; kick: () => void }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const running = run !== null
  const agent = job.hostMode === "agent"
  const stats: [string, string][] = [
    ["Snapshots", String(job.snapshots)],
    ["Added to storage", formatBytes(job.stored)],
    [agent ? "Runs" : "Every", agent ? "On the server" : every(job.intervalMin)],
    ["Keeps", `${job.retention.daily}d · ${job.retention.weekly}w · ${job.retention.monthly}m`],
  ]
  return (
    <div className="flex flex-col gap-5">
      <Strip job={job} running={running} />
      <div className="flex flex-wrap gap-2">
        {!agent && (
          <Button
            className={TOUCH}
            disabled={pending || running || job.paused}
            onClick={() =>
              start(async () => {
                setError(undefined)
                const r = await backupNow(job.id)
                if (r.error) return setError(r.error)
                setNotice({ text: "Backup started" })
                kick()
              })
            }
          >
            Back up now
          </Button>
        )}
        {agent ? (
          <a href={`/api/server-backup/script/${job.id}`} download className={cn(buttonVariants({ variant: "outline" }), TOUCH)}>
            <DownloadSimpleIcon />
            Download nimbus-agent.sh
          </a>
        ) : null}
        {!agent && (
          <Button
            variant="outline"
            className={TOUCH}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setPaused(job.id, !job.paused)
                if (r.error) return setError(r.error)
                setNotice({ text: job.paused ? "Resumed." : "Paused." })
              })
            }
          >
            {job.paused ? <PlayIcon /> : <PauseIcon />}
            {job.paused ? "Resume" : "Pause"}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {run && <Live run={run} />}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {agent && (
        <section aria-label="Run the agent" className="grid gap-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Run the agent on {job.hostLabel}</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            It needs <code className="font-mono">restic</code> and <code className="font-mono">curl</code>. It fetches this job&apos;s settings with the server&apos;s token, backs up the paths locally, and reports back here. Run it from cron:
          </p>
          <Code>{`0 3 * * * NIMBUS_AGENT_TOKEN='<the agent token>' /usr/local/bin/nimbus-agent.sh`}</Code>
          <p className="text-sm text-muted-foreground">Lost the token? Make a new one under Servers.</p>
        </section>
      )}
    </div>
  )
}
