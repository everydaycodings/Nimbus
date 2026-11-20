"use client"

import { useId, useState } from "react"

import { RADIO, RADIO_INPUT } from "@/components/registry-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_INTERVAL, MIN_INTERVAL, PRESETS } from "@/lib/import/rules"

// Once, or pull again every so often. A pull only brings what is new or changed: what is already in Files is skipped.
export function ScheduleFields({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const id = useId()
  const [custom, setCustom] = useState(() => value !== null && !PRESETS.some(([m]) => m === value))
  const tooLow = value !== null && value < MIN_INTERVAL
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">When</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={RADIO}>
          <input type="radio" name={`${id}-when`} className={RADIO_INPUT} checked={value === null} onChange={() => (setCustom(false), onChange(null))} />
          Once
        </label>
        {PRESETS.map(([m, label]) => (
          <label key={m} className={RADIO}>
            <input type="radio" name={`${id}-when`} className={RADIO_INPUT} checked={!custom && value === m} onChange={() => (setCustom(false), onChange(m))} />
            Every {label.toLowerCase() === "daily" ? "day" : label.toLowerCase() === "weekly" ? "week" : label}
          </label>
        ))}
        <label className={RADIO}>
          <input type="radio" name={`${id}-when`} className={RADIO_INPUT} checked={custom} onChange={() => (setCustom(true), onChange(value ?? 1440))} />
          Custom
        </label>
      </div>
      {custom && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-min`}>Minutes between pulls</Label>
          <Input id={`${id}-min`} type="number" inputMode="numeric" min={MIN_INTERVAL} max={MAX_INTERVAL} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-40 tabular-nums pointer-coarse:h-11" aria-invalid={tooLow || undefined} />
          {tooLow && <p className="text-sm text-destructive">The shortest is {MIN_INTERVAL} minutes.</p>}
        </div>
      )}
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {value === null ? "The import runs once, right after you create it. You can run it again from Overview." : "Each pull brings over what is new or changed at the source. Files already in Nimbus are skipped, and nothing in Nimbus is ever deleted."}
      </p>
    </fieldset>
  )
}
