"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import type { Conflict } from "@/app/(app)/upload-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// "version" is New version for a file and Merge for a folder.
export type Choice = "version" | "keep" | "skip"
export type Answers = Map<string, Choice>

// Asks about each name clash, one at a time, folders first. A folder kept as a
// copy or skipped can't clash inside, so its files are never asked about.
export function ConflictDialog({
  conflicts,
  replace = false,
  onDone,
}: {
  conflicts: Conflict[]
  // Vault files have no versions: "version" replaces the file instead.
  replace?: boolean
  // null when the person cancels the whole upload.
  onDone: (answers: Answers | null) => void
}) {
  const [answers, setAnswers] = useState<Answers>(new Map())
  const [all, setAll] = useState(false)
  const order = [
    ...conflicts.filter((c) => c.kind === "folder"),
    ...conflicts.filter((c) => c.kind === "file"),
  ]

  const pending = (a: Answers) =>
    order.filter(
      (c) =>
        !a.has(c.path) &&
        !order.some(
          (f) =>
            f.kind === "folder" &&
            a.has(f.path) &&
            a.get(f.path) !== "version" &&
            c.path.startsWith(`${f.path}/`)
        )
    )

  const left = pending(answers)
  const cur = left[0]
  if (!cur) return null
  const folder = cur.kind === "folder"
  const slash = cur.path.lastIndexOf("/")
  const name = cur.path.slice(slash + 1)
  const where = slash > 0 ? cur.path.slice(0, slash) : null

  function answer(choice: Choice) {
    const next = new Map(answers)
    next.set(cur.path, choice)
    if (all)
      for (let c = pending(next)[0]; c; c = pending(next)[0])
        next.set(c.path, choice)
    if (!pending(next).length) onDone(next)
    else setAnswers(next)
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onDone(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-w-lg")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold text-balance break-words">
              {folder
                ? `A folder named “${name}” already exists`
                : `“${name}” already exists`}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {where && (
                <>
                  In <span className="font-mono text-xs">{where}</span>.{" "}
                </>
              )}
              {folder
                ? `Merge adds what you're uploading to the existing folder. Keep both uploads it as “${cur.freeName}”.`
                : replace
                  ? `Replace deletes the current file. Keep both uploads it as “${cur.freeName}”.`
                  : `New version keeps the current file in its version history. Keep both uploads it as “${cur.freeName}”.`}
            </Dialog.Description>
          </div>
          {left.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
                className="size-4 accent-brand"
              />
              Apply to all remaining ({left.length - 1})
            </label>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close
              render={<Button variant="ghost" className="sm:mr-auto" />}
            >
              Cancel upload
            </Dialog.Close>
            <Button variant="outline" onClick={() => answer("skip")}>
              Skip
            </Button>
            <Button variant="outline" onClick={() => answer("keep")}>
              Keep both
            </Button>
            <Button onClick={() => answer("version")}>
              {folder ? "Merge" : replace ? "Replace" : "New version"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
