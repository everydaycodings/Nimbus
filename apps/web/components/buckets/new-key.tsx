"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useId, useState, useTransition } from "react"

import { createKey } from "@/app/(app)/buckets/actions"
import { BucketPicker } from "@/components/buckets/bucket-picker"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { RADIO, RADIO_INPUT } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BucketRow } from "@/lib/s3api/manage"
import { cn } from "@/lib/utils"

const EXPIRY = [
  ["never", "Never"],
  ["30", "In 30 days"],
  ["90", "In 90 days"],
  ["365", "In a year"],
  ["date", "On a date…"],
]

export function NewKey({
  open,
  buckets,
  preset,
  onClose,
}: {
  open: boolean
  buckets: BucketRow[]
  // A bucket id to start with "Only some buckets" and that one ticked.
  preset?: string | null
  onClose: () => void
}) {
  const [made, setMade] = useState<{ accessKeyId: string; secret: string }>()
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<string[]>([])
  const [expiry, setExpiry] = useState("never")
  const [pending, start] = useTransition()
  const id = useId()
  // A fresh form each time it opens, with the preset bucket ticked.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && preset) {
      setAll(false)
      setChosen([preset])
    }
  }
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))

  const close = () => {
    onClose()
    // After the dialog fades out.
    setTimeout(() => {
      setMade(undefined)
      setError(null)
      setAll(true)
      setChosen([])
      setExpiry("never")
    }, 200)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              {made ? "Your new access key" : "New access key"}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {made
                ? "Put both in the app now. The secret is shown only once; if you lose it, revoke the key and make another."
                : "One per app. Pick what it can reach and when it stops working."}
            </Dialog.Description>
          </div>
          {made ? (
            <>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                {(
                  [
                    ["Access key ID", made.accessKeyId],
                    ["Secret access key", made.secret],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid min-w-0 gap-1.5">
                    <span className="text-sm font-medium">{label}</span>
                    <div className="flex min-w-0 items-center gap-2">
                      <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">
                        {value}
                      </code>
                      <CopyButton value={value} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button onClick={close}>Done</Button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                setError(null)
                start(async () => {
                  const r = await createKey({
                    name: String(f.get("name") ?? ""),
                    access: String(f.get("access") ?? ""),
                    allBuckets: all,
                    bucketIds: chosen,
                    expiry: expiry === "date" ? String(f.get("date") ?? "") : expiry,
                  })
                  if (r.error || !r.secret) return setError(r.error ?? "Couldn't make the key.")
                  setMade({ accessKeyId: r.accessKeyId!, secret: r.secret })
                })
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input
                  id={`${id}-name`}
                  name="name"
                  maxLength={60}
                  placeholder="Laptop – rclone"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Access</legend>
                {(
                  [
                    ["rw", "Read & write", "List, download, upload and delete."],
                    ["ro", "Read only", "List and download, nothing else."],
                  ] as const
                ).map(([value, label, hint], i) => (
                  <label key={value} className={RADIO}>
                    <input
                      type="radio"
                      name="access"
                      value={value}
                      defaultChecked={i === 0}
                      className={RADIO_INPUT}
                    />
                    <span className="grid">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Buckets</legend>
                <label className={RADIO}>
                  <input
                    type="radio"
                    name="scope"
                    checked={all}
                    onChange={() => setAll(true)}
                    className={RADIO_INPUT}
                  />
                  <span className="grid">
                    <span className="font-medium">All buckets</span>
                    <span className="text-xs text-muted-foreground">Including ones you make later.</span>
                  </span>
                </label>
                <label className={cn(RADIO, !buckets.length && "cursor-not-allowed opacity-60")}>
                  <input
                    type="radio"
                    name="scope"
                    checked={!all}
                    disabled={!buckets.length}
                    onChange={() => setAll(false)}
                    className={RADIO_INPUT}
                  />
                  <span className="grid">
                    <span className="font-medium">Only some buckets</span>
                    <span className="text-xs text-muted-foreground">
                      {buckets.length ? "Pick which." : "Make a bucket first."}
                    </span>
                  </span>
                </label>
                {!all && <BucketPicker buckets={buckets} value={chosen} onChange={setChosen} />}
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-expiry`}>Expires</Label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id={`${id}-expiry`}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {EXPIRY.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {expiry === "date" && (
                    <Input
                      name="date"
                      type="date"
                      aria-label="Expiry date"
                      min={tomorrow}
                      required
                      className="w-auto flex-1"
                    />
                  )}
                </div>
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Create key</SubmitButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

