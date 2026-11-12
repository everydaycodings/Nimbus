"use client"

import { ImageIcon, PlusIcon, UsersIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { createAlbum } from "@/app/(app)/photo-actions"
import { NameDialog } from "@/components/album-dialogs"
import { PhotoChips } from "@/components/photos-timeline"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import type { Album } from "@nimbus/shared/api"

function Cover({ a }: { a: Album }) {
  return (
    <Link
      href={`/photos/albums/${a.id}`}
      className="group block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="relative block aspect-square overflow-hidden rounded-xl bg-muted/40">
        {a.cover ? (
          <Thumb
            item={{ id: a.cover.id, version: a.cover.version, thumb: a.cover.thumb, name: "", mime: null } as never}
            make={false}
            className="absolute inset-0 transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
          >
            <ImageIcon weight="light" className="absolute inset-0 m-auto size-8 text-muted-foreground" />
          </Thumb>
        ) : (
          <ImageIcon weight="light" className="absolute inset-0 m-auto size-8 text-muted-foreground" />
        )}
      </span>
      <span className="mt-2 flex items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{a.name}</span>
        {a.shared && <UsersIcon aria-label="Shared" className="size-3.5 shrink-0 text-muted-foreground" />}
      </span>
      <span className="block truncate text-xs text-muted-foreground tabular-nums">
        {a.count} {a.count === 1 ? "item" : "items"}
        {a.role !== "owner" && ` · ${a.ownerName}`}
      </span>
    </Link>
  )
}

function Section({ title, albums }: { title: string; albums: Album[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {albums.map((a) => (
          <li key={a.id}>
            <Cover a={a} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Albums I made, and albums shared with me.
export function AlbumsGrid({ albums, mapOn }: { albums: Album[]; mapOn: boolean }) {
  const router = useRouter()
  const [naming, setNaming] = useState(false)
  const mine = albums.filter((a) => a.role === "owner")
  const theirs = albums.filter((a) => a.role !== "owner")
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Albums</h1>
          <p className="text-sm text-muted-foreground">Sets of photos that stay where they are.</p>
        </div>
        <Button onClick={() => setNaming(true)}>
          <PlusIcon />
          New album
        </Button>
      </div>
      <PhotoChips active="albums" mapOn={mapOn} />
      {albums.length === 0 && (
        <div className="grid place-items-center py-16 text-center">
          <div className="max-w-sm space-y-1">
            <ImageIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">No albums yet</p>
            <p className="text-sm text-muted-foreground">
              Make one, add photos, and share it with people or a link.
            </p>
          </div>
        </div>
      )}
      {mine.length > 0 && <Section title="Yours" albums={mine} />}
      {theirs.length > 0 && <Section title="Shared with you" albums={theirs} />}
      <NameDialog
        open={naming}
        title="New album"
        label="Album name"
        onClose={() => setNaming(false)}
        onSubmit={async (name) => {
          const res = await createAlbum(name)
          if (res.error || !res.id) return res
          router.push(`/photos/albums/${res.id}`)
        }}
      />
    </div>
  )
}
