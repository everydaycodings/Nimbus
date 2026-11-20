"use client"

import { CaretDownIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useId, useState } from "react"

import { Empty, LIST, WHEN } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { formatBytes } from "@/lib/file-rules"
import type { RunView } from "@/lib/server-backup/jobs"
import { cn } from "@/lib/utils"
import { duration } from "./format"

const TRIGGER = { schedule: "Scheduled", manual: "Manual", first: "First backup", agent: "Agent" }

function RunRow({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4">
        <CaretDownIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(run.startedAt))}</span>
        <Badge variant="outline" className={cn(run.status === "failed" && "text-destructive")}>{run.status === "ok" ? "Succeeded" : run.status === "running" ? "Running" : "Failed"}</Badge>
        <Badge variant="secondary">{TRIGGER[run.trigger]}</Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {run.files ? `${run.files.toLocaleString()} files · ` : ""}{formatBytes(run.bytes)} · {duration(run.startedAt, run.finishedAt)}
        </span>
      </button>
      {open && (
        <div id={id} className="grid gap-2 border-t bg-background/40 px-4 py-3">
          {run.error && <p className="text-sm text-pretty text-destructive">{run.error}</p>}
          {run.snapshotId && <p className="text-xs text-muted-foreground">Snapshot <span className="font-mono">{run.snapshotId.slice(0, 8)}</span></p>}
          {run.logTail ? <pre className="max-h-64 overflow-auto rounded-lg bg-input/20 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{run.logTail}</pre> : <p className="text-sm text-muted-foreground">No log was kept for this run.</p>}
        </div>
      )}
    </li>
  )
}

export function History({ runs }: { runs: RunView[] }) {
  const id = useId()
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <div className="grid gap-1">
        <h2 id={id} className="text-base font-semibold">Runs</h2>
        <p className="text-sm text-muted-foreground">Every backup of this job, newest first. Open one to see the log.</p>
      </div>
      {runs.length === 0 ? (
        <Empty icon={ClockCounterClockwiseIcon} title="No runs yet">The first backup shows up here as soon as it starts.</Empty>
      ) : (
        <ul className={LIST}>{runs.map((r) => <RunRow key={r.id} run={r} />)}</ul>
      )}
      {runs.length >= 30 && <p className="text-sm text-muted-foreground">Showing the latest 30.</p>}
    </section>
  )
}
