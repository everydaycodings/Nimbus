"use client"

import { CaretDownIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useId, useState } from "react"

import { Empty } from "@/components/empty-state"
import { LIST, WHEN } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { formatBytes } from "@/lib/file-rules"
import type { RunView } from "@/lib/import/jobs"
import { cn } from "@/lib/utils"
import { count, duration } from "./format"

const TRIGGER = { first: "First import", manual: "Manual", schedule: "Scheduled" }
const STATUS = { ok: "Succeeded", partial: "Partly failed", failed: "Failed", cancelled: "Stopped", running: "Running" }

function RunRow({ run }: { run: RunView }) {
  const [open, setOpen] = useState(run.errors.length > 0 && run.status === "failed")
  const id = useId()
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4">
        <CaretDownIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(run.startedAt))}</span>
        <Badge variant="outline" className={cn((run.status === "failed" || run.status === "partial") && "text-destructive")}>{STATUS[run.status]}</Badge>
        <Badge variant="secondary">{TRIGGER[run.trigger]}</Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {count(run.filesDone)} brought over · {count(run.filesSkipped)} skipped{run.filesFailed ? ` · ${count(run.filesFailed)} failed` : ""} · {formatBytes(run.bytesDone)} · {duration(run.startedAt, run.finishedAt)}
        </span>
      </button>
      {open && (
        <ul id={id} className="border-t bg-background/40">
          {run.errors.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No problems were recorded.</li>}
          {run.errors.map((e, i) => (
            <li key={i} className="px-4 py-2 text-sm text-pretty text-destructive">{e}</li>
          ))}
          {run.filesFailed > run.errors.length && <li className="px-4 py-2 text-xs text-muted-foreground">Showing the first {run.errors.length} of {run.filesFailed} failures. Open Items and filter by Failed for the rest.</li>}
        </ul>
      )}
    </li>
  )
}

export function History({ runs }: { runs: RunView[] }) {
  if (runs.length === 0)
    return (
      <Empty icon={ClockCounterClockwiseIcon} title="No runs yet">
        <p>Each run is listed here with what it brought over, skipped and couldn&apos;t import.</p>
      </Empty>
    )
  return <ul className={LIST}>{runs.map((r) => <RunRow key={r.id} run={r} />)}</ul>
}
