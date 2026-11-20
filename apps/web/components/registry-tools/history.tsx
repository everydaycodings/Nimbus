"use client"

import { CaretDownIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useId, useState } from "react"

import { Empty } from "@/components/empty-state"
import { LIST, WHEN } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { formatBytes } from "@/lib/file-rules"
import type { RunView } from "@/lib/registry/tools"
import { cn } from "@/lib/utils"
import { duration } from "@/components/gitbackup/format"

const summary = (r: RunView) =>
  r.status === "running"
    ? "Running"
    : r.kind === "rule"
      ? `${r.changed} removed${r.bytes ? ` · ${formatBytes(r.bytes)} freed` : ""}`
      : `${r.changed} tag${r.changed === 1 ? "" : "s"} copied${r.bytes ? ` · ${formatBytes(r.bytes)}` : ""}`

function Row({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4">
        <CaretDownIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        <span className="text-sm font-medium" suppressHydrationWarning>{WHEN.format(new Date(run.startedAt))}</span>
        <span className="min-w-0 truncate text-sm" title={run.label}>{run.label}</span>
        <Badge variant="outline" className={cn(run.status === "failed" && "text-destructive")}>
          {run.status === "ok" ? "Succeeded" : run.status === "running" ? "Running" : "Failed"}
        </Badge>
        <Badge variant="secondary">{run.kind === "rule" ? "Rule" : "Mirror"} · {run.trigger === "manual" ? "Manual" : "Scheduled"}</Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{summary(run)} · {duration(run.startedAt, run.finishedAt)}</span>
      </button>
      {open && (
        <ul id={id} className="border-t bg-background/40">
          {run.lines.length === 0 && !run.error && <li className="px-4 py-3 text-sm text-muted-foreground">{run.status === "running" ? "Working on it…" : "Nothing changed."}</li>}
          {run.lines.map((l, i) => (
            <li key={i} className={cn("px-4 py-2 font-mono text-xs break-words", /failed/.test(l) && "text-destructive")}>{l}</li>
          ))}
          {run.error && <li role="alert" className="px-4 py-2 text-sm text-pretty text-destructive">{run.error}</li>}
        </ul>
      )}
    </li>
  )
}

export function History({ runs }: { runs: RunView[] }) {
  if (!runs.length)
    return (
      <Empty icon={ClockCounterClockwiseIcon} title="No runs yet">
        Rule and mirror runs show up here, with what each one removed or copied and why one failed.
      </Empty>
    )
  return (
    <ul className={LIST}>
      {runs.map((r) => (
        <Row key={r.id} run={r} />
      ))}
    </ul>
  )
}
