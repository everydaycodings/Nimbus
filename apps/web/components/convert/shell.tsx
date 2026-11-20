"use client"

import { CheckCircleIcon, CircleNotchIcon, FilmSlateIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { cancel, clearDone, deletePreset } from "@/app/(app)/more/convert/actions"
import { Empty, LIST, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import type { JobView, PresetView, Quota, WatchView } from "@/lib/convert/jobs"
import { cn } from "@/lib/utils"
import { ConvertDialog } from "./convert-dialog"
import { describe, left } from "./format"
import { Picker } from "./picker"
import { PresetDialog } from "./preset-dialog"
import { useQueue } from "./use-queue"
import { Watches } from "./watches"

export function Shell(props: { jobs: JobView[]; presets: PresetView[]; watches: WatchView[]; quota: Quota }) {
  const { jobs, quota, stale, refresh } = useQueue({ jobs: props.jobs, quota: props.quota })
  const [picking, setPicking] = useState(false)
  const [items, setItems] = useState<{ id: string; name: string }[] | null>(null)
  const finished = jobs.some((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled")
  const [pending, run] = useTransition()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="mr-auto grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Media converter</h1>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            Change the format, shrink, resize or trim videos, audio and images. The converted file is saved next to the original, which stays untouched. You can also right-click a file in Files and choose Convert.
          </p>
        </div>
        <Button className={TOUCH} onClick={() => setPicking(true)}>
          <PlusIcon />
          Convert files
        </Button>
      </header>

      <section aria-labelledby="convert-queue" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="convert-queue" className="mr-auto text-base font-semibold">Queue</h2>
          {quota && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {Math.min(quota.usedMin, quota.limitMin)} of {quota.limitMin} min today
            </span>
          )}
          {finished && (
            <Button variant="ghost" size="sm" className="pointer-coarse:h-11" disabled={pending} onClick={() => run(async () => { await clearDone(); refresh() })}>
              Clear finished
            </Button>
          )}
        </div>
        {stale && <p role="status" className="text-sm text-muted-foreground">Can&apos;t reach the server. Showing the last list; trying again.</p>}
        {jobs.length === 0 ? (
          <Empty icon={FilmSlateIcon} title="Nothing converting">
            <p>Pick files to convert and they show up here with live progress.</p>
            <Button variant="outline" className={TOUCH} onClick={() => setPicking(true)}>Convert files</Button>
          </Empty>
        ) : (
          <ul className={LIST}>
            {jobs.map((j) => (
              <Row key={j.id} job={j} onCancel={() => run(async () => { await cancel(j.id); refresh() })} />
            ))}
          </ul>
        )}
      </section>

      <Presets presets={props.presets} />
      <Watches watches={props.watches} presets={props.presets} />

      <Picker open={picking} onClose={() => setPicking(false)} onPick={(i) => { setPicking(false); setItems(i) }} />
      <ConvertDialog items={items} onClose={() => setItems(null)} onQueued={refresh} />
    </div>
  )
}

function Row({ job: j, onCancel }: { job: JobView; onCancel: () => void }) {
  const active = j.status === "queued" || j.status === "running"
  const Icon = j.status === "done" ? CheckCircleIcon : j.status === "failed" ? WarningCircleIcon : j.status === "cancelled" ? XIcon : CircleNotchIcon
  return (
    <li className="flex items-center gap-3 p-3 pointer-coarse:p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon aria-hidden className={cn("size-5", j.status === "done" && "text-brand", j.status === "failed" && "text-destructive", j.status === "running" && "animate-spin motion-reduce:animate-none", (j.status === "queued" || j.status === "cancelled") && "text-muted-foreground")} />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="truncate text-sm font-medium" title={j.inputName}>
          {j.inputName} <span className="font-normal text-muted-foreground">to {j.presetName}</span>
        </p>
        {j.status === "running" ? (
          <>
            <div role="progressbar" aria-label={`Converting ${j.inputName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${j.progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{j.progress}%{j.etaSec !== null && ` · ${left(j.etaSec)}`}</p>
          </>
        ) : j.status === "queued" ? (
          <p className="text-xs text-muted-foreground">Waiting its turn</p>
        ) : j.status === "done" ? (
          <p className="truncate text-xs text-muted-foreground" title={j.outputName ?? undefined}>Saved as {j.outputName}</p>
        ) : j.status === "failed" ? (
          <p className="text-xs text-pretty text-destructive">{j.error ?? "It didn't work."}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Cancelled</p>
        )}
      </div>
      {active && (
        <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={onCancel} aria-label={`Cancel converting ${j.inputName}`}>
          Cancel
        </Button>
      )}
    </li>
  )
}

function Presets({ presets }: { presets: PresetView[] }) {
  const [edit, setEdit] = useState<PresetView | null>(null)
  const [open, setOpen] = useState(false)
  const [, run] = useTransition()
  const [sure, setSure] = useState<string | null>(null)
  const mine = presets.filter((p) => p.own)
  const row = (p: PresetView) => (
    <li key={p.id} className="flex items-center gap-3 p-3">
      <div className="mr-auto grid min-w-0 gap-0.5">
        <p className="truncate text-sm font-medium">{p.name}</p>
        <p className="text-sm text-pretty text-muted-foreground">{describe(p.preset)}</p>
      </div>
      {p.own &&
        (sure === p.id ? (
          <>
            <Button variant="destructive" size="sm" className="pointer-coarse:h-11" onClick={() => run(async () => { await deletePreset(p.id); setSure(null) })}>Delete</Button>
            <Button variant="ghost" size="sm" className="pointer-coarse:h-11" autoFocus onClick={() => setSure(null)}>Keep</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label={`Edit ${p.name}`} onClick={() => { setEdit(p); setOpen(true) }}>
              <PencilSimpleIcon />
            </Button>
            <Button variant="ghost" size="icon" className="pointer-coarse:size-11" aria-label={`Delete ${p.name}`} onClick={() => setSure(p.id)}>
              <TrashIcon />
            </Button>
          </>
        ))}
    </li>
  )
  return (
    <section aria-labelledby="convert-presets" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="mr-auto grid gap-0.5">
          <h2 id="convert-presets" className="text-base font-semibold">Presets</h2>
          <p className="text-sm text-pretty text-muted-foreground">Ready-made settings, and your own.</p>
        </div>
        <Button variant="outline" className={TOUCH} onClick={() => { setEdit(null); setOpen(true) }}>
          <PlusIcon />
          New preset
        </Button>
      </div>
      {mine.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className="text-sm font-medium text-muted-foreground">Yours</h3>
          <ul className={LIST}>{mine.map(row)}</ul>
        </div>
      )}
      <div className="grid gap-1.5">
        <h3 className="text-sm font-medium text-muted-foreground">Built in</h3>
        <ul className={LIST}>{presets.filter((p) => !p.own).map(row)}</ul>
      </div>
      <PresetDialog open={open} edit={edit} onClose={() => setOpen(false)} />
    </section>
  )
}
