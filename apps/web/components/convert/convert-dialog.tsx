"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useId, useMemo, useState, useTransition } from "react"

import { convertOptions, start } from "@/app/(app)/more/convert/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PresetView } from "@/lib/convert/jobs"
import { inKind, parseTime, takes } from "@/lib/convert/rules"
import { cn } from "@/lib/utils"
import { describe } from "./format"

type Item = { id: string; name: string }
type Options = Awaited<ReturnType<typeof convertOptions>>

// Pick a preset for the files, then queue them. Used by Convert… in the file menu and by Convert files on the tool page.
export function ConvertDialog({ items, onClose, onQueued }: { items: Item[] | null; onClose: () => void; onQueued?: () => void }) {
  const id = useId()
  const setNotice = useNotice()
  const [opts, setOpts] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [pick, setPick] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()

  // A new set of files starts the dialog over.
  const [seen, setSeen] = useState(items)
  if (items !== seen) {
    setSeen(items)
    setOpts(null)
    setLoadError(false)
    setError(undefined)
    setPick("")
    setFrom("")
    setTo("")
  }
  useEffect(() => {
    if (!items) return
    let live = true
    convertOptions().then(
      (o) => live && setOpts(o),
      () => live && setLoadError(true)
    )
    return () => {
      live = false
    }
  }, [items])

  const kinds = useMemo(() => (items ?? []).map((i) => inKind(i.name)), [items])
  const presets: PresetView[] = opts && !opts.off ? opts.presets.filter((p) => kinds.some((k) => takes(p.preset, k))) : []
  const chosen = presets.find((p) => p.id === pick)
  const trimmable = chosen?.preset.kind === "video" || chosen?.preset.kind === "gif"
  const n = items?.length ?? 0

  function submit() {
    if (!items || !chosen) return
    const start_ = parseTime(from)
    const end = parseTime(to)
    if ((from && start_ === null) || (to && end === null)) return setError("Write times like 1:30 or 90.")
    if (start_ !== null && end !== null && end <= start_) return setError("The end has to be after the start.")
    setError(undefined)
    run(async () => {
      const r = await start(items.map((i) => i.id), chosen.id, trimmable ? { ...(start_ !== null && { start: start_ }), ...(end !== null && { end }) } : undefined).catch(() => null)
      if (!r) return setError("Couldn't queue that. Check your connection and try again.")
      if (r.error) return setError(r.error)
      if (!r.queued) return setError(r.skipped[0]?.why ?? "Nothing could be converted.")
      const skipped = r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0].why}` : ""
      setNotice({ text: `${r.queued === 1 ? `Converting “${items[0].name}”` : `Converting ${r.queued} files`} with ${chosen.name}. Follow it in More, Media converter.${skipped}` })
      onQueued?.()
      onClose()
    })
  }

  return (
    <Dialog.Root open={items !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Convert {n === 1 ? `“${items![0].name}”` : `${n} files`}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              The converted file is saved next to the original, which stays as it is.
            </Dialog.Description>
          </div>

          {loadError ? (
            <p role="alert" className="text-sm text-destructive">Couldn&apos;t load the presets. Close this and try again.</p>
          ) : !opts ? (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading presets…</p>
          ) : opts.off ? (
            <p role="status" className="py-4 text-sm text-pretty text-muted-foreground">The media converter is turned off on this server. Ask an admin to turn it on.</p>
          ) : presets.length === 0 ? (
            <p role="status" className="py-4 text-sm text-pretty text-muted-foreground">There is no preset for this kind of file.</p>
          ) : (
            <>
              <div role="radiogroup" aria-label="Preset" className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
                {presets.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:bg-muted/40 has-checked:border-brand/60 has-checked:bg-brand/8 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 pointer-coarse:p-3"
                  >
                    <input type="radio" name={`${id}-preset`} value={p.id} checked={pick === p.id} onChange={() => setPick(p.id)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate font-medium">{p.name}{p.own && <span className="ml-2 text-xs font-normal text-muted-foreground">Yours</span>}</span>
                      <span className="text-pretty text-muted-foreground">{p.own ? describe(p.preset) : p.text}</span>
                    </span>
                  </label>
                ))}
              </div>
              {trimmable && (
                <fieldset className="grid grid-cols-2 gap-3">
                  <legend className="mb-1.5 text-sm font-medium">Trim <span className="font-normal text-muted-foreground">(optional)</span></legend>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-from`} className="text-muted-foreground">Start</Label>
                    <Input id={`${id}-from`} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" inputMode="numeric" autoComplete="off" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-to`} className="text-muted-foreground">End</Label>
                    <Input id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="end" inputMode="numeric" autoComplete="off" />
                  </div>
                </fieldset>
              )}
              {opts.quota && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {Math.min(opts.quota.usedMin, opts.quota.limitMin)} of {opts.quota.limitMin} minutes used today.
                </p>
              )}
            </>
          )}
          {error && <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button className={TOUCH} disabled={pending || !chosen} onClick={submit}>
              {pending ? "Queuing…" : "Convert"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
