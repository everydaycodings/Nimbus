"use client"

import { CheckCircleIcon, CircleNotchIcon, PauseIcon, PlayIcon, WarningCircleIcon, WarningIcon, GithubLogoIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { backupNow, setPaused } from "@/app/(app)/more/github-backup/actions"
import { LIST, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-rules"
import type { JobView } from "@/lib/gitbackup/jobs"
import type { Progress, RepoStage } from "@/lib/gitbackup/runner"
import { cn } from "@/lib/utils"
import { ago, every } from "./format"

const STAGE: Record<RepoStage, string> = { queued: "Queued", checking: "Checking", cloning: "Cloning", packing: "Packing", uploading: "Uploading", done: "Backed up", skipped: "Unchanged", failed: "Failed" }

type Look = { Icon: typeof CheckCircleIcon; title: string; line: string; tone: string }

function look(job: JobView, running: boolean): Look {
  if (running) return { Icon: CircleNotchIcon, title: "Backing up now", line: "Progress is shown below.", tone: "text-foreground" }
  if (job.paused) return { Icon: PauseIcon, title: "Paused", line: "Nothing is backed up until you resume.", tone: "text-muted-foreground" }
  if (job.lastStatus === "failed")
    return { Icon: WarningCircleIcon, title: "The last backup failed", line: `${job.failStreak > 1 ? `${job.failStreak} runs in a row failed. ` : ""}Open History to see why.`, tone: "text-destructive" }
  if (job.lastStatus === "partial" || job.errors > 0)
    return { Icon: WarningIcon, title: "Some repos had problems", line: `${job.errors} repo${job.errors === 1 ? "" : "s"} failed. Open Repos to see the errors.`, tone: "text-destructive" }
  if (!job.lastRunAt) return { Icon: CircleNotchIcon, title: "Waiting for the first backup", line: "It starts as soon as the worker picks it up.", tone: "text-muted-foreground" }
  return { Icon: CheckCircleIcon, title: "Everything is backed up", line: `Last backup ${ago(job.lastRunAt)}. Next ${ago(job.nextDueAt, "when due")}.`, tone: "text-brand" }
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

export function Overview({ job, progress, kick }: { job: JobView; progress: Progress; kick: () => void }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const running = progress !== null
  const run = (force: boolean) =>
    start(async () => {
      setError(undefined)
      const r = await backupNow(job.id, { force })
      if (r.error) return setError(r.error)
      setNotice({ text: force ? "Snapshot of every repo started" : "Backup started" })
      kick()
    })
  const stats: [string, string][] = [
    ["Repos", String(job.repos)],
    ["Snapshots", String(job.snapshots)],
    ["Stored", formatBytes(job.bytes)],
    ["Every", every(job.intervalMin)],
  ]
  return (
    <div className="flex flex-col gap-5">
      <Strip job={job} running={running} />
      <div className="flex flex-wrap gap-2">
        <Button className={TOUCH} disabled={pending || running} onClick={() => run(false)}>
          Back up now
        </Button>
        <Button variant="outline" className={TOUCH} disabled={pending || running} onClick={() => run(true)} title="Snapshot every repo even if nothing changed">
          Force snapshot
        </Button>
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
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {running && progress && (
        <section aria-label="Backup progress" className="grid gap-2">
          <h2 className="text-sm font-semibold">Running since {WHEN.format(new Date(progress.startedAt))}</h2>
          <ul className={LIST}>
            {progress.repos.map((r) => (
              <li key={r.repoId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <GithubLogoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={r.repo}>{r.repo}</span>
                {r.bytes ? <span className="tabular-nums text-muted-foreground">{formatBytes(r.bytes)}</span> : null}
                <span className={cn("w-24 text-right", r.stage === "failed" ? "text-destructive" : "text-muted-foreground")}>{STAGE[r.stage]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {job.gone > 0 && (
        <p className="text-sm text-pretty text-muted-foreground">
          {job.gone} repo{job.gone === 1 ? " is" : "s are"} gone from GitHub or no longer reachable with this token. Their snapshots are kept.
        </p>
      )}
    </div>
  )
}
