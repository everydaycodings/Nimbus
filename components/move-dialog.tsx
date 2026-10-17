"use client"

import { Dialog } from "@base-ui/react/dialog"
import { CaretRightIcon, FolderIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { listFolders } from "@/app/(app)/file-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"

export type Place = { id: string | null; name: string }

// Folder picker. Starts at `start` (root first) and walks down one level at a time.
export function MoveDialog({
  open,
  title,
  moving,
  start,
  onClose,
  onMove,
}: {
  open: boolean
  title: string
  moving: string[]
  start: Place[]
  onClose: () => void
  onMove: (to: Place) => void
}) {
  const [path, setPath] = useState(start)
  const here = path[path.length - 1]
  // Folders of the place they were loaded for; stale while the next place loads.
  const [loaded, setLoaded] = useState<{
    at: string | null
    folders: { id: string; name: string }[]
  } | null>(null)
  const folders = loaded?.at === here.id ? loaded.folders : null

  // Reset to the starting place each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPath(start)
  }

  useEffect(() => {
    if (!open) return
    let live = true
    listFolders(here.id).then(
      (f) => live && setLoaded({ at: here.id, folders: f })
    )
    return () => {
      live = false
    }
  }, [open, here.id])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <Dialog.Title className="truncate text-base font-semibold">
            {title}
          </Dialog.Title>

          <nav
            aria-label="Location"
            className="-mx-1 flex flex-wrap items-center gap-0.5 text-sm"
          >
            {path.map((p, i) =>
              i === path.length - 1 ? (
                <span
                  key={p.id ?? "root"}
                  aria-current="location"
                  className="truncate px-1 font-medium"
                >
                  {p.name}
                </span>
              ) : (
                <span
                  key={p.id ?? "root"}
                  className="flex min-w-0 items-center gap-0.5"
                >
                  <button
                    type="button"
                    onClick={() => setPath(path.slice(0, i + 1))}
                    className="truncate rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {p.name}
                  </button>
                  <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
                </span>
              )
            )}
          </nav>

          <div className="h-64 overflow-y-auto rounded-lg border">
            {folders === null ? (
              <div
                className="flex flex-col gap-1 p-1"
                aria-label="Loading folders"
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-9 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : folders.length === 0 ? (
              <p className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
                No folders inside {here.name}.
              </p>
            ) : (
              <ul className="flex flex-col p-1">
                {folders.map((f) => {
                  const self = moving.includes(f.id)
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        disabled={self}
                        title={
                          self ? "A folder can't go inside itself" : undefined
                        }
                        onClick={() => setPath([...path, f])}
                        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <FolderIcon
                          weight="fill"
                          className="size-4 shrink-0 text-file-folder"
                        />
                        <span className="flex-1 truncate">{f.name}</span>
                        <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button variant="outline" />}>
              Cancel
            </Dialog.Close>
            <Button onClick={() => onMove(here)}>Move here</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
