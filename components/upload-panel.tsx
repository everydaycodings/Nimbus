"use client"

import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type { Job } from "@/components/upload-provider"
import { fileType } from "@/lib/file-types"
import { formatBytes } from "@/lib/file-rules"
import { cn } from "@/lib/utils"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const pct = (j: Job) => (j.size ? Math.floor((j.sent / j.size) * 100) : 0)

function left(s: number) {
  if (s < 60) return `${Math.max(1, Math.round(s))} sec left`
  if (s < 3600) return `${Math.ceil(s / 60)} min left`
  return `${Math.floor(s / 3600)} hr ${Math.ceil((s % 3600) / 60)} min left`
}

// Bytes per second over the last ~10 seconds while active, else null.
function useSpeed(sent: number, active: boolean) {
  const [speed, setSpeed] = useState<number | null>(null)
  const live = useRef(sent)
  useEffect(() => {
    live.current = sent
  })
  useEffect(() => {
    if (!active) return
    const samples: { t: number; sent: number }[] = []
    const id = setInterval(() => {
      const sent = live.current
      if (samples.length && sent < samples[samples.length - 1].sent)
        samples.length = 0
      samples.push({ t: Date.now(), sent })
      if (samples.length > 10) samples.shift()
      const a = samples[0]
      const b = samples[samples.length - 1]
      const s = (b.sent - a.sent) / ((b.t - a.t) / 1000 || 1)
      setSpeed(s > 0 ? s : null)
    }, 1000)
    return () => {
      clearInterval(id)
      setSpeed(null)
    }
  }, [active])
  return active ? speed : null
}

const rate = (s: number | null) => (s ? `${formatBytes(s)}/s` : null)

// Drive-style corner panel: overall status, then one row per upload or zip.
export function UploadPanel({
  jobs,
  stale,
  collapsed,
  onCollapse,
  onPause,
  onResume,
  onCancel,
  onPauseAll,
  onResumeAll,
  onClose,
  onResumeStale,
  onDismissStale,
  onOpen,
}: {
  jobs: Job[]
  // Unfinished uploads remembered from a previous visit.
  stale: number
  collapsed: boolean
  onCollapse: (c: boolean) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onPauseAll: () => void
  onResumeAll: () => void
  onClose: () => void
  onResumeStale: () => void
  onDismissStale: () => void
  onOpen: (j: Job) => void
}) {
  const ups = jobs.filter((j) => j.kind === "upload")
  const done = ups.filter((j) => j.status === "done").length
  const failed = ups.filter((j) => j.status === "error").length
  const running = ups.filter(
    (j) => j.status === "uploading" || j.status === "queued"
  )
  const paused = ups.some((j) => j.status === "paused")
  const zipping = jobs.find((j) => j.kind === "zip" && j.status === "uploading")
  const busy = running.length > 0 || paused || Boolean(zipping)
  const counted = ups.filter((j) => j.status !== "error")
  const size = counted.reduce((n, j) => n + j.size, 0)
  const sent = counted.reduce((n, j) => n + j.sent, 0)

  // Speed and time left from the last ~10 seconds of overall throughput.
  const speed = useSpeed(sent, running.length > 0)
  const eta = [rate(speed), speed && left((size - sent) / speed)]
    .filter(Boolean)
    .join(" · ")
  const zipSpeed = rate(useSpeed(zipping?.sent ?? 0, Boolean(zipping)))

  // All done with no failures: collapse after ~5 s, then clear. Hover or focus
  // holds it open; leaving restarts a shorter countdown.
  const settled =
    !busy &&
    stale === 0 &&
    jobs.length > 0 &&
    jobs.every((j) => j.status === "done")
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!settled || held) return
    let clear: ReturnType<typeof setTimeout>
    const t = setTimeout(() => {
      onCollapse(true)
      clear = setTimeout(onClose, 400)
    }, 5000)
    return () => {
      clearTimeout(t)
      clearTimeout(clear)
    }
  }, [settled, held, onCollapse, onClose])

  const title = running.length
    ? `Uploading ${done} of ${ups.length}${eta ? ` · ${eta}` : ""}`
    : zipping
      ? `Zipping ${zipping.name}${zipSpeed ? ` · ${zipSpeed}` : ""}`
      : paused
        ? `Paused · ${done} of ${ups.length} uploaded`
        : ups.length
          ? failed
            ? `${done} uploaded · ${failed} failed`
            : `${plural(done, "upload")} complete`
          : jobs.length
            ? "Download ready"
            : "Unfinished uploads"

  return (
    <section
      aria-label="Uploads"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) =>
        !e.currentTarget.contains(e.relatedTarget as Node) && setHeld(false)
      }
      className="fixed right-4 bottom-4 z-40 flex w-96 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto"
    >
      <div className="relative flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
          {title}
        </h2>
        <span aria-live="polite" className="sr-only">
          {ups.length > 0 && `${done} of ${ups.length} uploaded`}
          {failed > 0 && `, ${failed} failed`}
        </span>
        {running.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Pause all"
            title="Pause all"
            onClick={onPauseAll}
          >
            <PauseIcon />
          </Button>
        ) : (
          paused && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Resume all"
              title="Resume all"
              onClick={onResumeAll}
            >
              <PlayIcon />
            </Button>
          )
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand uploads" : "Collapse uploads"}
          title={collapsed ? "Expand" : "Collapse"}
          onClick={() => onCollapse(!collapsed)}
        >
          {collapsed ? <CaretUpIcon /> : <CaretDownIcon />}
        </Button>
        {!busy && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close uploads"
            title="Close"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        )}
        {running.length > 0 && size > 0 && (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 bg-muted"
          >
            <span
              className="block h-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${(sent / size) * 100}%` }}
            />
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="max-h-72 overflow-y-auto border-t max-sm:max-h-[40svh]">
          {stale > 0 && (
            <div className="flex flex-col gap-2 border-b px-4 py-3 text-sm">
              <p className="flex items-center gap-2">
                <ClockCounterClockwiseIcon className="size-4 shrink-0 text-muted-foreground" />
                {plural(stale, "upload")} didn&apos;t finish last time
              </p>
              <div className="flex gap-2 pl-6">
                <Button size="xs" variant="outline" onClick={onResumeStale}>
                  Choose files to resume
                </Button>
                <Button size="xs" variant="ghost" onClick={onDismissStale}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
          <ul className="flex flex-col py-1">
            {jobs.map((j) => (
              <Row
                key={j.id}
                job={j}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Row({
  job: j,
  onPause,
  onResume,
  onCancel,
  onOpen,
}: {
  job: Job
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onOpen: (j: Job) => void
}) {
  const t = fileType("file", j.mime || null, j.name)
  const zip = j.kind === "zip"
  const p = pct(j)
  const speed = rate(useSpeed(j.sent, j.status === "uploading"))

  const status =
    j.status === "done" ? (
      <span className="flex items-center gap-1">
        <CheckCircleIcon weight="fill" className="size-3.5 text-brand" />
        {zip ? "Saved" : j.version ? `v${j.version} added` : "Done"}
      </span>
    ) : j.status === "error" ? (
      <span className="truncate text-destructive" title={j.error}>
        {j.error}
      </span>
    ) : j.status === "queued" ? (
      "Waiting"
    ) : j.status === "paused" ? (
      `Paused · ${p}%`
    ) : zip && !j.size ? (
      "Preparing"
    ) : (
      `${p}%${speed ? ` · ${speed}` : ""}`
    )

  const body = (
    <>
      <t.icon className={cn("size-5 shrink-0", t.color)} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm" title={j.name}>
          {j.name}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {(j.status === "uploading" || j.status === "paused") && (
            <span
              role="progressbar"
              aria-label={`${j.name} progress`}
              aria-valuenow={p}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  "block h-full transition-[width] duration-300 motion-reduce:transition-none",
                  j.status === "paused" ? "bg-muted-foreground" : "bg-brand"
                )}
                style={{ width: `${p}%` }}
              />
            </span>
          )}
          {status}
        </span>
      </span>
    </>
  )

  if (j.status === "done" && !zip)
    return (
      <li>
        <button
          type="button"
          title="Show in folder"
          onClick={() => onOpen(j)}
          className="flex w-full items-center gap-3 px-4 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {body}
        </button>
      </li>
    )

  return (
    <li className="flex items-center gap-3 py-2 pr-2 pl-4">
      {body}
      <span className="flex shrink-0 items-center">
        {!zip && (j.status === "uploading" || j.status === "queued") && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Pause ${j.name}`}
            title="Pause"
            onClick={() => onPause(j.id)}
          >
            <PauseIcon />
          </Button>
        )}
        {j.status === "paused" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Resume ${j.name}`}
            title="Resume"
            onClick={() => onResume(j.id)}
          >
            <PlayIcon />
          </Button>
        )}
        {j.status === "error" && !j.final && !zip && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Retry ${j.name}`}
            title="Retry"
            onClick={() => onResume(j.id)}
          >
            <ArrowClockwiseIcon />
          </Button>
        )}
        {j.status !== "done" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              j.status === "error" ? `Remove ${j.name}` : `Cancel ${j.name}`
            }
            title={j.status === "error" ? "Remove" : "Cancel"}
            onClick={() => onCancel(j.id)}
          >
            <XIcon />
          </Button>
        )}
      </span>
    </li>
  )
}
