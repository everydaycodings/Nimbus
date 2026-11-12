"use client"

import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Previewer, downloadHref } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { fileType } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

// A public album: a grid of photos and the shared Previewer, both reading through the link
// (its token goes to Thumb and Previewer as "a:<token>").
export function AlbumView({
  token,
  items,
  download,
}: {
  token: string
  items: Item[]
  download: boolean
}) {
  const link = `a:${token}`
  const [open, setOpen] = useState<string | null>(null)
  const at = items.findIndex((i) => i.id === open)
  return (
    <>
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          There are no photos in this album yet.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((i) => {
            const t = fileType("file", i.mime, i.name)
            const href = downloadHref(i, undefined, { token: link, download })
            return (
              <li key={i.id} className="group relative aspect-square">
                <button
                  type="button"
                  aria-label={`Open ${i.name}`}
                  onClick={() => setOpen(i.id)}
                  className="block size-full overflow-hidden rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Thumb
                    item={i}
                    make={false}
                    link={link}
                    className="grid size-full place-items-center bg-muted/40"
                  >
                    <t.icon className={cn("size-8", t.color)} />
                  </Thumb>
                </button>
                {href && (
                  <a
                    href={href}
                    aria-label={`Download ${i.name}`}
                    className="absolute right-1 bottom-1 grid size-8 place-items-center rounded-full bg-background/80 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:opacity-100"
                  >
                    <DownloadSimpleIcon className="size-4" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Previewer
        shown={at >= 0 ? { item: items[at] } : null}
        open={at >= 0}
        onClose={() => setOpen(null)}
        onPrev={at > 0 ? () => setOpen(items[at - 1].id) : undefined}
        onNext={
          at >= 0 && at < items.length - 1
            ? () => setOpen(items[at + 1].id)
            : undefined
        }
        position={items.length > 1 && at >= 0 ? `${at + 1} of ${items.length}` : undefined}
        link={{ token: link, download }}
      />
    </>
  )
}
