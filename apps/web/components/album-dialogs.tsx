"use client"

import { Dialog } from "@base-ui/react/dialog"
import { CheckIcon, CircleNotchIcon, ImageIcon, PlusIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { addToAlbum, createAlbum, getAlbums } from "@/app/(app)/photo-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Thumb } from "@/components/thumb"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Album, PhotoItem, PhotosResponse } from "@nimbus/shared/api"
import { cn } from "@/lib/utils"

// A dialog with one text field: a new album, or a new name for one.
export function NameDialog({
  open,
  title,
  initial = "",
  label,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  initial?: string
  label: string
  onClose: () => void
  onSubmit: (name: string) => Promise<{ error?: string } | void>
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Reset whenever it opens again.
  const [was, setWas] = useState(open)
  if (open !== was) {
    setWas(open)
    if (open) {
      setName(initial)
      setError(null)
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              const res = await onSubmit(name)
              setBusy(false)
              if (res?.error) setError(res.error)
            }}
          >
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Input
              aria-label={label}
              placeholder={label}
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || busy}>
                {title.startsWith("New") ? "Create" : "Save"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// "Add to album" for photos picked in Files or Photos: one of my albums, or a new one.
export function AddToAlbumDialog({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const notice = useNotice()
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [naming, setNaming] = useState(false)
  const [shown, setShown] = useState(ids)
  if (ids && ids !== shown) {
    setShown(ids)
    setAlbums(null)
  }
  useEffect(() => {
    if (!ids) return
    getAlbums().then((r) => setAlbums(r.albums.filter((a) => a.role !== "viewer")), () => setAlbums([]))
  }, [ids])

  async function add(a: Album) {
    const res = await addToAlbum(a.id, shown!)
    onClose()
    notice(
      res.error
        ? { text: res.error, error: true }
        : { text: `Added ${res.added} to “${a.name}”.` }
    )
  }

  return (
    <>
      <Dialog.Root open={Boolean(ids) && !naming} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)]")}>
            <Dialog.Title className="text-base font-semibold">Add to album</Dialog.Title>
            {albums === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
                Loading…
              </p>
            ) : (
              <ul className="-mx-2 flex min-h-0 flex-col overflow-y-auto">
                <li>
                  <button
                    type="button"
                    onClick={() => setNaming(true)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="grid size-10 place-items-center rounded-md bg-muted">
                      <PlusIcon className="size-5" />
                    </span>
                    New album…
                  </button>
                </li>
                {albums.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => add(a)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                        {a.cover && (
                          <Thumb
                            item={{ id: a.cover.id, version: a.cover.version, thumb: a.cover.thumb, name: "", mime: null } as never}
                            make={false}
                            className="size-full"
                          >
                            <ImageIcon className="m-auto size-5" />
                          </Thumb>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {a.count} {a.count === 1 ? "item" : "items"}
                          {a.role === "contributor" ? ` · ${a.ownerName}'s` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <NameDialog
        open={Boolean(ids) && naming}
        title="New album"
        label="Album name"
        onClose={() => setNaming(false)}
        onSubmit={async (name) => {
          const res = await createAlbum(name, shown!)
          if (res.error) return res
          setNaming(false)
          onClose()
          notice({ text: `Added to the new album “${name.trim()}”.` })
        }}
      />
    </>
  )
}

// Pick some of my photos to put in an album; the ones already in it are marked.
export function PickPhotosDialog({
  albumId,
  have,
  open,
  onClose,
  onAdded,
}: {
  albumId: string
  have: Set<string>
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [items, setItems] = useState<PhotoItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (from: string | null) =>
    fetch(`/api/v1/photos?partner=0&limit=200${from ? `&cursor=${encodeURIComponent(from)}` : ""}`)
      .then((res) => (res.ok ? (res.json() as Promise<PhotosResponse>) : Promise.reject()))
      .then(
        (page) => {
          setItems((m) => (from ? [...m, ...page.items] : page.items))
          setCursor(page.nextCursor)
          setLoaded(true)
        },
        () => setError("Couldn't load your photos.")
      )
  // Mounted only while open, so it starts fresh each time.
  useEffect(() => {
    void load(null)
  }, [])

  async function add() {
    setBusy(true)
    const res = await addToAlbum(albumId, [...picked])
    setBusy(false)
    if (res.error) return setError(res.error)
    onAdded()
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "h-[min(40rem,calc(100svh-2rem))] max-w-3xl")}>
          <Dialog.Title className="text-base font-semibold">Add photos</Dialog.Title>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
            {!loaded ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
                Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">You have no photos to add yet.</p>
            ) : (
              <ul className="grid grid-cols-4 gap-1 sm:grid-cols-5">
                {items.map((p) => {
                  const inAlbum = have.has(p.id)
                  const on = picked.has(p.id)
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-label={p.name}
                        aria-pressed={on || inAlbum}
                        disabled={inAlbum}
                        onClick={() =>
                          setPicked((s) => {
                            const n = new Set(s)
                            if (!n.delete(p.id)) n.add(p.id)
                            return n
                          })
                        }
                        className="relative block aspect-square w-full overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
                      >
                        <Thumb item={p} make={false} className="absolute inset-0">
                          <ImageIcon weight="light" className="absolute inset-0 m-auto size-6 text-muted-foreground" />
                        </Thumb>
                        {(on || inAlbum) && (
                          <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <CheckIcon weight="bold" className="size-3" />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {cursor && (
              <div className="flex justify-center py-3">
                <Button variant="outline" size="sm" onClick={() => load(cursor)}>
                  Load more
                </Button>
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!picked.size || busy} onClick={add}>
              {picked.size ? `Add ${picked.size}` : "Add"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Deleting an album keeps every photo in it.
export function DeleteDialog({
  open,
  name,
  onClose,
  onDelete,
}: {
  open: boolean
  name: string
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <Dialog.Title className="text-base font-semibold">Delete “{name}”?</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            The album and its shares and links go away. The photos in it are not deleted.
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onDelete()
                setBusy(false)
              }}
            >
              Delete album
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
