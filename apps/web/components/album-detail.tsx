"use client"

import { Menu } from "@base-ui/react/menu"
import {
  CheckIcon,
  DotsThreeIcon,
  ImageIcon,
  ImageSquareIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  ShareNetworkIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { deleteAlbum, removeFromAlbum, updateAlbum } from "@/app/(app)/photo-actions"
import { DeleteDialog, NameDialog, PickPhotosDialog } from "@/components/album-dialogs"
import { AlbumShareDialog } from "@/components/album-share-dialog"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { Previewer } from "@/components/previewer"
import { Slideshow } from "@/components/slideshow"
import { Thumb } from "@/components/thumb"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { IMAGE, VIDEO } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import type { AlbumResponse } from "@nimbus/shared/api"

// One album: its photos, and what I may do depends on my role (owner, contributor, viewer).
export function AlbumDetail({ data }: { data: AlbumResponse }) {
  const router = useRouter()
  const notice = useNotice()
  const { album, items } = data
  const owner = album.role === "owner"
  const canAdd = album.role !== "viewer"
  const [open, setOpen] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<"rename" | "share" | "add" | "delete" | "slides" | null>(null)
  const have = useMemo(() => new Set(items.map((i) => i.id)), [items])
  const stills = items.filter((p) => IMAGE.test(p.name))
  const removable = items.filter((i) => picked.has(i.id) && i.canRemove)
  const shown = open === null ? null : items[open]

  async function run(task: () => Promise<{ error?: string }>, done?: string) {
    const res = await task()
    if (res.error) notice({ text: res.error, error: true })
    else {
      if (done) notice({ text: done })
      router.refresh()
    }
    return res
  }
  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  }
  const step = (by: number) => () => open !== null && setOpen(open + by)

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-auto">
          <Link href="/photos/albums" className="text-sm text-muted-foreground hover:text-foreground">
            ← Albums
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{album.name}</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
            {items.length} {items.length === 1 ? "item" : "items"}
            {!owner && (
              <>
                <UsersIcon className="size-3.5" />
                {album.ownerName}
                {album.role === "contributor" ? " · you can add photos" : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!stills.length} onClick={() => setDialog("slides")}>
            <PlayIcon weight="fill" />
            Slideshow
          </Button>
          {canAdd && (
            <Button variant="outline" size="sm" onClick={() => setDialog("add")}>
              <PlusIcon />
              Add photos
            </Button>
          )}
          {owner && (
            <Button size="sm" onClick={() => setDialog("share")}>
              <ShareNetworkIcon />
              Share
            </Button>
          )}
          {owner && (
            <Menu.Root>
              <Menu.Trigger render={<Button variant="ghost" size="icon-sm" aria-label="Album actions" />}>
                <DotsThreeIcon weight="bold" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={4} align="end">
                  <Menu.Popup className={cn("w-44", MENU_POPUP)}>
                    <Menu.Item className={MENU_ITEM} onClick={() => setDialog("rename")}>
                      <PencilSimpleIcon />
                      Rename
                    </Menu.Item>
                    <Menu.Item className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")} onClick={() => setDialog("delete")}>
                      <TrashIcon />
                      Delete album
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
      </div>

      {picked.size > 0 && (
        <div role="toolbar" aria-label="Selected photos" className="sticky top-2 z-10 flex items-center gap-2 rounded-xl border bg-popover px-3 py-2 shadow-md">
          <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={() => setPicked(new Set())}>
            <XIcon />
          </Button>
          <span className="flex-1 text-sm tabular-nums">{picked.size} selected</span>
          {owner && picked.size === 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => run(() => updateAlbum(album.id, { coverNodeId: [...picked][0] }), "Cover changed.")}
            >
              <ImageSquareIcon />
              Make cover
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!removable.length}
            title={removable.length ? undefined : "You can only remove what you added"}
            onClick={async () => {
              const res = await run(
                () => removeFromAlbum(album.id, removable.map((i) => i.id)),
                `Removed ${removable.length} from the album.`
              )
              if (!res.error) setPicked(new Set())
            }}
          >
            Remove from album
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="max-w-sm space-y-1">
            <ImageIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">This album is empty</p>
            <p className="text-sm text-muted-foreground">
              {canAdd ? "Add photos and videos. They stay where they are." : "Nothing has been added yet."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((p, i) => {
            const on = picked.has(p.id)
            return (
              <li key={p.id} className="group relative aspect-square">
                <button
                  type="button"
                  aria-label={p.name}
                  onClick={() => (picked.size ? toggle(p.id) : setOpen(i))}
                  className="relative block size-full overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Thumb item={p} make={false} className="absolute inset-0">
                    <ImageIcon weight="light" className="absolute inset-0 m-auto size-8 text-muted-foreground" />
                  </Thumb>
                  {VIDEO.test(p.name) && (
                    <span className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-full bg-black/60 text-white">
                      <PlayIcon weight="fill" className="size-3" />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Select ${p.name}`}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "absolute top-1 left-1 grid size-6 place-items-center rounded-full border border-white/80 bg-black/40 text-white outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:opacity-100",
                    on ? "border-transparent bg-primary opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    picked.size > 0 && "opacity-100"
                  )}
                >
                  {on && <CheckIcon weight="bold" className="size-3.5" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Previewer
        shown={shown ? { item: shown } : null}
        open={shown != null}
        onClose={() => setOpen(null)}
        onPrev={open ? step(-1) : undefined}
        onNext={open !== null && open < items.length - 1 ? step(1) : undefined}
        position={shown ? `${open! + 1} of ${items.length}` : undefined}
      />
      {dialog === "slides" && (
        <Slideshow slides={stills.map((p) => ({ id: p.id, item: p }))} onClose={() => setDialog(null)} />
      )}
      {dialog === "add" && (
        <PickPhotosDialog
          albumId={album.id}
          have={have}
          open
          onClose={() => setDialog(null)}
          onAdded={() => router.refresh()}
        />
      )}
      <AlbumShareDialog albumId={album.id} name={album.name} open={dialog === "share"} onClose={() => setDialog(null)} />
      <NameDialog
        open={dialog === "rename"}
        title="Rename album"
        label="Album name"
        initial={album.name}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          const res = await run(() => updateAlbum(album.id, { name }))
          if (!res.error) setDialog(null)
          return res
        }}
      />
      <DeleteDialog
        open={dialog === "delete"}
        name={album.name}
        onClose={() => setDialog(null)}
        onDelete={async () => {
          const res = await deleteAlbum(album.id)
          if (res.error) return notice({ text: res.error, error: true })
          router.push("/photos/albums")
        }}
      />
    </div>
  )
}
