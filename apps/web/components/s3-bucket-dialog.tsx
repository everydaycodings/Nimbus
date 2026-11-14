"use client"

import { Dialog } from "@base-ui/react/dialog"
import { FolderIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import {
  createBucketFolder,
  markBucket,
  myBucketNames,
} from "@/app/(app)/buckets/actions"
import { MoveDialog, type Place } from "@/components/move-dialog"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { bucketNameError, suggestBucketName } from "@/lib/s3api/rules"

const ROOT: Place = { id: null, name: "My files" }

export const QUIET_HINT =
  "Skips thumbnails, search indexing, activity and edit notifications for files that arrive over S3. Good for backups and build output."

// Names a folder as an S3 bucket. With `folder` it marks that one; without,
// it's the page's "New bucket": a new folder under S3 buckets, or one picked.
export function BucketDialog({
  open,
  folder,
  onClose,
  onDone,
}: {
  open: boolean
  folder?: { id: string; name: string }
  onClose: () => void
  onDone: (name: string) => void
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [taken, setTaken] = useState<string[]>([])
  const [mode, setMode] = useState<"new" | "existing">("new")
  const [picked, setPicked] = useState<Place | null>(null)
  const [picking, setPicking] = useState(false)
  const [name, setName] = useState("")
  const [touched, setTouched] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const id = useId()

  const target = folder ?? (mode === "existing" ? picked : null)

  // A fresh form each time it opens, with the names already used.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setError(null)
      setTouched(false)
      setMode("new")
      setPicked(null)
      setName(folder ? suggestBucketName(folder.name) : "")
      setQuiet(!folder)
    }
  }
  useEffect(() => {
    if (open) myBucketNames().then(setTaken, () => setTaken([]))
  }, [open])

  const clean = name.trim()
  const problem = clean
    ? (bucketNameError(clean) ??
      (taken.includes(clean) ? "You already have a bucket with that name." : null))
    : null
  const shown = touched || clean ? problem : null

  function pick(p: Place) {
    setPicking(false)
    if (p.id === null) return setError("Pick a folder inside My files, not My files itself.")
    setError(null)
    setPicked(p)
    if (!touched) setName(suggestBucketName(p.name))
  }

  function submit() {
    setError(null)
    if (!clean) return setTouched(true)
    if (problem) return setError(problem)
    if (!folder && mode === "existing" && !target?.id) return setError("Choose a folder first.")
    start(async () => {
      const r =
        folder || mode === "existing"
          ? await markBucket((folder?.id ?? target!.id)!, clean, quiet)
          : await createBucketFolder(clean, quiet)
      if (r.error) return setError(r.error)
      onDone(clean)
    })
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">
                {folder ? "Use as S3 bucket" : "New bucket"}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                {folder
                  ? `“${folder.name}” opens to S3 apps under the name below. Its files stay where they are.`
                  : "S3 apps see a folder as a bucket. Make a new one or use a folder you already have; its files stay where they are."}
              </Dialog.Description>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              {!folder && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">Folder</legend>
                  {(
                    [
                      ["new", "Make a new folder", "Under “S3 buckets” in My files."],
                      ["existing", "Use an existing folder", "One of yours, as it is."],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        className="size-4 accent-primary"
                      />
                      <span className="grid">
                        <span className="font-medium">{label}</span>
                        <span className="text-xs text-muted-foreground">{hint}</span>
                      </span>
                    </label>
                  ))}
                  {mode === "existing" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-start"
                      onClick={() => setPicking(true)}
                    >
                      <FolderIcon weight="fill" className="text-file-folder" />
                      <span className="truncate">{picked ? picked.name : "Choose a folder…"}</span>
                    </Button>
                  )}
                </fieldset>
              )}
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Bucket name</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={63}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  className="font-mono"
                  aria-invalid={Boolean(shown)}
                  aria-describedby={`${id}-name-help`}
                  onChange={(e) => {
                    setName(e.target.value)
                    setTouched(true)
                    setError(null)
                  }}
                />
                <p
                  id={`${id}-name-help`}
                  role={shown ? "alert" : undefined}
                  className={shown ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
                >
                  {shown ?? "3 to 63 lowercase letters, numbers, dots and hyphens. Apps use this name."}
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  checked={quiet}
                  onChange={(e) => setQuiet(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">Quiet</span>
                  <span className="text-xs text-pretty text-muted-foreground">{QUIET_HINT}</span>
                </span>
              </label>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending} disabled={Boolean(problem)}>
                  {folder ? "Use as bucket" : "Create bucket"}
                </SubmitButton>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {!folder && (
        <MoveDialog
          open={picking}
          title="Choose a folder"
          moving={[]}
          start={[ROOT]}
          action="Use this folder"
          onClose={() => setPicking(false)}
          onMove={pick}
        />
      )}
    </>
  )
}
