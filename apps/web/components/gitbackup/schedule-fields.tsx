"use client"

import { useId, useState } from "react"

import { RADIO, RADIO_INPUT, Switch } from "@/components/registry-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PRESETS } from "./format"

export type Sched = { name: string; prefix: string; intervalMin: number; keepLast: number; lfs: boolean }

// Interval, how many snapshots to keep, LFS and the folder in the bucket. `name` shows only when the job has none yet.
// `compact`: only the name and interval (Server Backup keeps its own retention and folder; no LFS).
export function ScheduleFields({ value, onChange, min, showName, compact }: { value: Sched; onChange: (v: Sched) => void; min: number; showName?: boolean; compact?: boolean }) {
  const id = useId()
  const set = (p: Partial<Sched>) => onChange({ ...value, ...p })
  // Custom stays open while typing, even through a preset's value (60, 360…).
  const [custom, setCustom] = useState(() => !PRESETS.some(([m]) => m === value.intervalMin))
  const tooLow = value.intervalMin < min
  return (
    <div className="flex flex-col gap-5">
      {showName && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>Job name</Label>
          <Input id={`${id}-name`} value={value.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="My repos" autoComplete="off" className="pointer-coarse:h-11" />
        </div>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Back up every</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESETS.filter(([m]) => m >= min).map(([m, label]) => (
            <label key={m} className={RADIO}>
              <input type="radio" name={`${id}-every`} className={RADIO_INPUT} checked={!custom && value.intervalMin === m} onChange={() => (setCustom(false), set({ intervalMin: m }))} />
              {label}
            </label>
          ))}
          <label className={RADIO}>
            <input type="radio" name={`${id}-every`} className={RADIO_INPUT} checked={custom} onChange={() => setCustom(true)} />
            Custom
          </label>
        </div>
        {custom && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-min`}>Minutes between checks</Label>
            <Input id={`${id}-min`} type="number" inputMode="numeric" min={min} max={525600} value={value.intervalMin || ""} onChange={(e) => set({ intervalMin: Number(e.target.value) })} className="w-40 tabular-nums pointer-coarse:h-11" aria-invalid={tooLow || undefined} />
            {tooLow && <p className="text-sm text-destructive">The shortest allowed is {min} minutes.</p>}
          </div>
        )}
        {!compact && <p className="text-sm text-muted-foreground">A new snapshot is made only when a branch or tag changed.</p>}
      </fieldset>
      {!compact && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-keep`}>Snapshots to keep per repo</Label>
            <Input id={`${id}-keep`} type="number" inputMode="numeric" min={1} max={1000} value={value.keepLast || ""} onChange={(e) => set({ keepLast: Number(e.target.value) })} className="w-40 tabular-nums pointer-coarse:h-11" />
            <p className="text-sm text-muted-foreground">Older ones are deleted. Each snapshot is a full copy.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-prefix`}>Folder in the bucket</Label>
            <Input id={`${id}-prefix`} value={value.prefix} onChange={(e) => set({ prefix: e.target.value })} placeholder="git-backup" autoComplete="off" spellCheck={false} className="font-mono pointer-coarse:h-11" />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm">
            <span className="grid gap-0.5">
              <span className="font-medium">Include Git LFS files</span>
              <span className="text-muted-foreground">Large files stored with Git LFS are backed up too. Uses more space.</span>
            </span>
            <Switch checked={value.lfs} onChange={(e) => set({ lfs: e.target.checked })} />
          </label>
        </>
      )}
    </div>
  )
}
