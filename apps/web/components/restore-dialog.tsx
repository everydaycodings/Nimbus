"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useState } from "react"

import {
  applyRestore,
  getRestoreWindow,
  previewRestore,
  undoRestore,
  type RestorePreview,
} from "@/app/(app)/file-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const HOUR = 36e5
const PRESETS = [
  { label: "1 hour ago", ms: HOUR },
  { label: "Yesterday", ms: 24 * HOUR },
  { label: "1 week ago", ms: 7 * 24 * HOUR },
  { label: "30 days ago", ms: 30 * 24 * HOUR },
]
// What <input type="datetime-local"> takes and gives: local time, minutes.
const local = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 16)
const full = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const GROUPS = [
  ["trash", "Back from Trash"],
  ["versions", "Older versions"],
  ["renames", "Renamed back"],
  ["moves", "Moved back"],
  ["blocked", "Can’t restore"],
] as const
const SHOWN = 6

// Puts a folder (or all of My files) back the way it was at a chosen time, after a preview.
export function RestoreDialog({
  open,
  folderId,
  name,
  onClose,
}: {
  open: boolean
  folderId: string | null
  name: string
  onClose: () => void
}) {
  const setNotice = useNotice()
  const [at, setAt] = useState("")
  const [earliest, setEarliest] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; res: RestorePreview & { error?: string } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  // Each opening starts clean and asks how far back the activity history goes.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setAt("")
      setLoaded(null)
      setError(null)
    }
  }
  useEffect(() => {
    if (!open) return
    let live = true
    getRestoreWindow().then((w) => {
      if (!live) return
      setNow(Date.now())
      setEarliest(w.earliest ? Date.parse(w.earliest) : null)
    })
    return () => {
      live = false
    }
  }, [open])

  const ms = at ? new Date(at).getTime() : NaN
  const valid = Number.isFinite(ms)
  const key = `${folderId}:${at}`
  useEffect(() => {
    if (!open || !valid) return
    let live = true
    previewRestore(folderId, new Date(ms).toISOString()).then(
      (res) => live && setLoaded({ key, res })
    )
    return () => {
      live = false
    }
  }, [open, valid, ms, folderId, key])

  const res = loaded?.key === key ? loaded.res : null
  const preview = res && !res.error ? res : null
  const count = preview ? preview.trash.length + preview.versions.length + preview.renames.length + preview.moves.length : 0
  const where = folderId ? `“${name}”` : "My files"

  async function restore() {
    setBusy(true)
    setError(null)
    const r = await applyRestore(folderId, new Date(ms).toISOString())
    setBusy(false)
    if (r.error) return setError(r.error)
    const n = r.trash.length + r.versions.length + r.renames.length + r.moves.length
    onClose()
    setNotice({
      text: n
        ? `Restored ${where} to ${full(ms)}: ${plural(n, "change")}${r.blocked.length ? `, ${r.blocked.length} couldn’t come back` : ""}.`
        : `Nothing in ${where} needed restoring.`,
      undo: r.id ? () => undo(r.id!) : undefined,
    })
  }

  async function undo(id: string) {
    const r = await undoRestore(id)
    setNotice(
      r.error
        ? { text: r.error, error: true }
        : { text: `Undid the restore${r.skipped ? `. ${plural(r.skipped ?? 0, "change")} couldn’t go back` : ""}.` }
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1">
            <Dialog.Title className="truncate text-base font-semibold">Restore to a point in time</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Put {where} back the way it was. Newer files are kept, and you can undo this.
            </Dialog.Description>
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Go back to">
              {PRESETS.map((p) => {
                const t = Math.floor((now - p.ms) / 6e4) * 6e4
                return (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={at === local(t)}
                    disabled={!now || (earliest !== null && t < earliest)}
                    onClick={() => setAt(local(t))}
                    className="rounded-full aria-pressed:border-brand/40 aria-pressed:bg-brand/10 dark:aria-pressed:border-brand/40 dark:aria-pressed:bg-brand/10"
                  >
                    {p.label}
                  </Button>
                )
              })}
            </div>
            <Input
              type="datetime-local"
              aria-label="Date and time"
              value={at}
              max={now ? local(now) : undefined}
              min={earliest ? local(earliest) : undefined}
              onChange={(e) => setAt(e.target.value)}
            />
            {earliest !== null && (
              <p className="text-xs text-muted-foreground">History goes back to {full(earliest)}.</p>
            )}
          </div>

          <div className="max-h-72 min-h-16 overflow-y-auto rounded-lg border p-3 text-sm" aria-live="polite">
            {!valid ? (
              <p className="text-muted-foreground">Pick a time to see what would change.</p>
            ) : !res ? (
              <span className="block h-4 w-40 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
            ) : res.error ? (
              <p role="alert" className="text-destructive">{res.error}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {!count && !preview!.blocked.length && (
                  <p className="text-muted-foreground">Nothing has changed since then, so there’s nothing to restore.</p>
                )}
                {GROUPS.map(([k, title]) => {
                  const list = preview![k]
                  return (
                    list.length > 0 && (
                      <section key={k} className="flex flex-col gap-1">
                        <h3 className={cn("text-xs font-medium", k === "blocked" ? "text-destructive" : "text-muted-foreground")}>
                          {title} · {list.length}
                        </h3>
                        <ul className="flex flex-col gap-0.5">
                          {list.slice(0, SHOWN).map((i) => (
                            <li key={i.id} className="break-words">
                              {i.name}
                              {i.detail && <span className="text-muted-foreground"> {i.detail}</span>}
                            </li>
                          ))}
                          {list.length > SHOWN && (
                            <li className="text-muted-foreground">and {list.length - SHOWN} more</li>
                          )}
                        </ul>
                      </section>
                    )
                  )
                })}
                {preview!.untracked > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {plural(preview!.untracked, "item")} {preview!.untracked === 1 ? "was" : "were"} renamed or moved before
                    Nimbus started keeping track of renames and moves, so {preview!.untracked === 1 ? "it stays" : "they stay"} as {preview!.untracked === 1 ? "it is" : "they are"}.
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={busy} render={<Button variant="outline" />}>
              Cancel
            </Dialog.Close>
            <SubmitButton type="button" pending={busy} disabled={!count} onClick={restore}>
              Restore
            </SubmitButton>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
