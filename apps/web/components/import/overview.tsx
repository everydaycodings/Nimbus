"use client"

import { CheckCircleIcon, CircleNotchIcon, PauseIcon, PlayIcon, StopIcon, WarningCircleIcon, WarningIcon, ArrowCircleDownIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { controlRun, runNow, setPaused } from "@/app/(app)/more/import/actions"
import { Confirm, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-rules"
import type { JobView } from "@/lib/import/jobs"
import type { Progress } from "@/lib/import/runner"
import { cn } from "@/lib/utils"
import { ago, count, every, span } from "./format"

type Look = { Icon: typeof CheckCircleIcon; title: string; line: string; tone: string; spin?: boolean }

function look(job: JobView, p: Progress): Look {
  if (p?.state === "paused") return { Icon: PauseIcon, title: "Paused", line: "The current file finishes, then it waits until you resume.", tone: "text-muted-foreground" }
  if (p) return { Icon: CircleNotchIcon, title: "Importing now", line: "Progress is shown below.", tone: "text-foreground", spin: true }
  if (job.paused) return { Icon: PauseIcon, title: "Scheduled pulls are paused", line: "Nothing runs on its own until you resume.", tone: "text-muted-foreground" }
  if (job.lastStatus === "failed") return { Icon: WarningCircleIcon, title: "The last run failed", line: `${job.failStreak > 1 ? `${job.failStreak} runs in a row failed. ` : ""}Open History to see why.`, tone: "text-destructive" }
  if (job.lastStatus === "partial") return { Icon: WarningIcon, title: "Some files couldn't be imported", line: "Open Items, filtered to Failed, to see which. The next run tries them again.", tone: "text-destructive" }
  if (job.lastStatus === "cancelled") return { Icon: StopIcon, title: "The last run was stopped", line: "Run it again to carry on where it stopped. Files already brought over are skipped.", tone: "text-muted-foreground" }
  if (!job.lastRunAt) return { Icon: CircleNotchIcon, title: "Waiting to start", line: "It starts as soon as the worker picks it up.", tone: "text-muted-foreground" }
  return { Icon: CheckCircleIcon, title: "Up to date", line: `Last run ${ago(job.lastRunAt)}.${job.intervalMin ? ` Next ${ago(job.nextDueAt, "when due")}.` : ""}`, tone: "text-brand" }
}

export function Overview({ job, progress, kick }: { job: JobView; progress: Progress; kick: () => void }) {
  const setNotice = useNotice()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const running = progress !== null
  const { Icon, title, line, tone, spin } = look(job, progress)
  const act = (f: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => {
      setError(undefined)
      const r = await f()
      if (r.error) return setError(r.error)
      if (ok) setNotice({ text: ok })
      kick()
    })
  const doneAll = progress ? progress.filesDone + progress.filesSkipped + progress.filesFailed : 0
  const pct = progress ? Math.min(100, progress.bytesTotal > 0 ? (progress.bytesDone / progress.bytesTotal) * 100 : progress.filesTotal > 0 ? (doneAll / progress.filesTotal) * 100 : 0) : 0
  const stats: [string, string][] = [
    ["Brought over", count(job.imported)],
    ["Size", formatBytes(job.bytes)],
    [job.intervalMin ? "Pulls every" : "Runs", job.intervalMin ? every(job.intervalMin) : "Once"],
    ["Into", job.target?.path ?? "Folder is gone"],
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon aria-hidden className={cn("size-5", tone, spin && "animate-spin motion-reduce:animate-none")} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-pretty text-muted-foreground" suppressHydrationWarning>{line}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {running ? (
          <>
            {progress.state === "paused" ? (
              <Button className={TOUCH} disabled={pending} onClick={() => act(() => controlRun(job.id, "resume"), "Resumed.")}>
                <PlayIcon />
                Resume
              </Button>
            ) : (
              <Button variant="outline" className={TOUCH} disabled={pending} onClick={() => act(() => controlRun(job.id, "pause"), "Pausing after this file.")}>
                <PauseIcon />
                Pause
              </Button>
            )}
            <Confirm label="Cancel" question="Stop this import? What is already imported stays." yes="Stop import" pending={pending} size="default" onYes={() => act(() => controlRun(job.id, "cancel"), "Stopping.")} />
          </>
        ) : (
          <>
            <Button className={TOUCH} disabled={pending || !job.target} onClick={() => act(() => runNow(job.id), "Import started.")}>
              <ArrowCircleDownIcon />
              {job.lastRunAt ? "Import now" : "Start import"}
            </Button>
            {job.intervalMin && (
              <Button variant="outline" className={TOUCH} disabled={pending} onClick={() => act(() => setPaused(job.id, !job.paused), job.paused ? "Resumed." : "Paused.")}>
                {job.paused ? <PlayIcon /> : <PauseIcon />}
                {job.paused ? "Resume pulls" : "Pause pulls"}
              </Button>
            )}
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {progress && (
        <section aria-label="Import progress" className="grid gap-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold" suppressHydrationWarning>{progress.state === "paused" ? "Paused" : "Running"} since {WHEN.format(new Date(progress.startedAt))}</h2>
            <p className="text-sm text-muted-foreground tabular-nums" suppressHydrationWarning>{progress.etaSec !== null && progress.state === "running" ? `About ${span(progress.etaSec)} left` : progress.filesTotal ? `${Math.round(pct)}%` : "Starting…"}</p>
          </div>
          <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Files</dt><dd>{count(doneAll)}{progress.filesTotal ? ` of ${count(progress.filesTotal)}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Data</dt><dd>{formatBytes(progress.bytesDone)}{progress.bytesTotal ? ` of ${formatBytes(progress.bytesTotal)}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Skipped</dt><dd>{count(progress.filesSkipped)}</dd></div>
            <div><dt className="text-muted-foreground">Failed</dt><dd className={progress.filesFailed ? "text-destructive" : undefined}>{count(progress.filesFailed)}</dd></div>
          </dl>
          {progress.current && <p className="truncate text-sm text-muted-foreground" title={progress.current}>Now: {progress.current}</p>}
        </section>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="mt-1 truncate text-lg font-semibold tabular-nums" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {!job.target && <p role="alert" className="text-sm text-pretty text-destructive">The target folder was deleted. Choose another in Settings before the next run.</p>}
    </div>
  )
}
