"use client"

import { Dialog } from "@base-ui/react/dialog"
import { FileAudioIcon, FileImageIcon, FileVideoIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState } from "react"

import { findMedia } from "@/app/(app)/more/convert/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Media } from "@/lib/convert/jobs"
import { formatBytes } from "@/lib/file-rules"
import { cn } from "@/lib/utils"

const ICON = { video: FileVideoIcon, audio: FileAudioIcon, image: FileImageIcon }

// Search your video, audio and image files and tick the ones to convert.
export function Picker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (items: { id: string; name: string }[]) => void }) {
  const id = useId()
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<Media[] | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<Map<string, Media>>(new Map())

  useEffect(() => {
    if (!open) return
    let live = true
    const t = setTimeout(() => {
      setError(false)
      findMedia(q).then(
        (r) => live && setRows(r),
        () => live && (setError(true), setRows([]))
      )
    }, q ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open])

  // Closing forgets the search and the ticks.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setQ("")
      setRows(null)
      setPicked(new Map())
    }
  }

  const toggle = (m: Media) =>
    setPicked((p) => {
      const next = new Map(p)
      if (!next.delete(m.id)) next.set(m.id, m)
      return next
    })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] max-w-lg")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Convert files</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">Pick the videos, audio or images to convert. Newest first.</Dialog.Description>
          </div>
          <div className="relative">
            <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={`${id}-q`} aria-label="Search your files" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="pl-8" autoComplete="off" />
          </div>
          <div className="-mx-1 min-h-40 flex-1 overflow-y-auto px-1">
            {rows === null ? (
              <p role="status" className="py-10 text-center text-sm text-muted-foreground">Looking…</p>
            ) : error ? (
              <p role="alert" className="py-10 text-center text-sm text-destructive">Couldn&apos;t search your files. Try again.</p>
            ) : rows.length === 0 ? (
              <p role="status" className="py-10 text-center text-sm text-pretty text-muted-foreground">{q ? "No video, audio or image file has that name." : "You have no video, audio or image files yet."}</p>
            ) : (
              <ul className="grid gap-1">
                {rows.map((m) => {
                  const Icon = ICON[m.kind]
                  return (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 pointer-coarse:py-2.5">
                        <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m)} className="size-4 shrink-0 accent-primary" />
                        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate" title={m.name}>{m.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(m.size)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">{picked.size ? `${picked.size} picked` : ""}</span>
            <Button variant="outline" className={TOUCH} onClick={onClose}>
              Cancel
            </Button>
            <Button className={TOUCH} disabled={picked.size === 0} onClick={() => onPick([...picked.values()].map((m) => ({ id: m.id, name: m.name })))}>
              Next
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
