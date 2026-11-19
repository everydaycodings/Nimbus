"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { setBucketQuota } from "@/app/(app)/buckets/actions"
import { Heading, SECTION, SELECT, Segmented } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-types"
import type { BucketConfig } from "@/lib/s3api/bucket-config"

const UNIT_BYTES = { MB: 2 ** 20, GB: 2 ** 30, TB: 2 ** 40 }
type Unit = keyof typeof UNIT_BYTES

// The GB (or MB when smaller) form of a byte count.
function sizeField(bytes: number | null) {
  if (bytes === null) return { value: "", unit: "GB" as Unit }
  const unit: Unit = bytes < UNIT_BYTES.GB ? "MB" : "GB"
  return { value: String(+(bytes / UNIT_BYTES[unit]).toFixed(2)), unit }
}

// A limit on the bucket's size; uploads past it fail with QuotaExceeded.
export function SettingsQuota({ bucketId, c }: { bucketId: string; c: BucketConfig }) {
  const router = useRouter()
  const setNotice = useNotice()
  const id = useId()
  const start = sizeField(c.quotaBytes)
  const [on, setOn] = useState(c.quotaBytes !== null)
  const [size, setSize] = useState(start.value)
  const [unit, setUnit] = useState<Unit>(start.unit)
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()
  const n = Number(size)
  const bytes = on ? Math.round(n * UNIT_BYTES[unit]) : null
  const invalid = on && !(n > 0)
  const limit = c.quotaBytes ?? c.defaultQuotaBytes
  const share = limit ? Math.min(100, (c.bytes / limit) * 100) : 0

  return (
    <section className={SECTION} aria-labelledby="quota-heading">
      <Heading
        id="quota-heading"
        title="Storage limit"
        hint="Uploads that would take the bucket past the limit fail with a QuotaExceeded error. Files already there stay."
      />
      <form
        className="grid gap-4 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          run(async () => {
            const r = await setBucketQuota(bucketId, bytes)
            if (r.error) return setError(r.error)
            setNotice({ text: bytes === null ? "Removed the storage limit." : `Limit set to ${formatBytes(bytes)}.` })
            router.refresh()
          })
        }}
      >
        <Segmented
          label="Storage limit"
          value={on ? "custom" : "off"}
          options={[
            ["off", c.defaultQuotaBytes ? "Server default" : "No limit"],
            ["custom", "Own limit"],
          ]}
          onChange={(v) => setOn(v === "custom")}
        />
        {on && (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-size`}>Limit</Label>
            <div className="grid max-w-xs grid-cols-[1fr_6rem] gap-2">
              <Input
                id={`${id}-size`}
                type="number"
                min={0.01}
                step="any"
                inputMode="decimal"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-hint`}
              />
              <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={SELECT}>
                {Object.keys(UNIT_BYTES).map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <p id={`${id}-hint`} className="min-h-5 text-sm text-destructive">
              {invalid && "Enter a size above zero."}
            </p>
          </div>
        )}
        {!on && c.defaultQuotaBytes ? (
          <p className="text-sm text-muted-foreground">Server default: {formatBytes(c.defaultQuotaBytes)}</p>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex justify-between gap-3 text-sm tabular-nums">
            <span>{formatBytes(c.bytes)} used</span>
            <span className="text-muted-foreground">{limit ? `of ${formatBytes(limit)}` : "No limit"}</span>
          </div>
          {limit ? (
            <div
              role="meter"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(c.bytes, limit)}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className={share >= 90 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${share}%` }} />
            </div>
          ) : null}
        </div>
        <div>
          <SubmitButton pending={pending} disabled={invalid || bytes === c.quotaBytes}>
            Save limit
          </SubmitButton>
        </div>
        <FormError>{error}</FormError>
      </form>
    </section>
  )
}
