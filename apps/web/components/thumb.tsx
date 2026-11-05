"use client"

import { useEffect, useRef, useState } from "react"

import { previewKind, thumbable } from "@/lib/file-rules"
import type { Item } from "@/lib/files"
import { ensureThumb } from "@/lib/thumbs"
import { cn } from "@/lib/utils"

// Pages and code read from the top; photos and video frames from the middle.
const TOP = new Set(["pdf", "text", "markdown", "csv"])

// A file's thumbnail, cover-filled, or `children` (its icon) until there is one.
// With `make`, a missing thumbnail is drawn once the tile scrolls into view.
export function Thumb({
  item,
  make,
  link,
  className,
  children,
}: {
  item: Item
  make: boolean
  // On a public link's page, thumbnails come through the link.
  link?: string
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // A thumbnail drawn here, for the version and server state it was drawn from.
  const [made, setMade] = useState<{ from: string; rev: string } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const kind = previewKind(item.mime, item.name)
  const v = item.version
  const from = `${v}:${item.thumb}`
  const rev = item.thumb || (made?.from === from ? made.rev : null)
  const src =
    v && rev
      ? link
        ? `/s/${link}/thumb/${item.id}?r=${rev}`
        : `/api/files/${item.id}/thumb?v=${v}&r=${rev}`
      : null
  const has = Boolean(src) && broken !== src

  useEffect(() => {
    const el = ref.current
    if (has || !make || item.thumb !== null || !v || !thumbable(kind) || !el)
      return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        ensureThumb(item).then((rev) => rev && setMade({ from, rev }))
      },
      { rootMargin: "200px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [has, make, item, v, kind, from])

  return (
    <div ref={ref} className={cn("overflow-hidden", className)}>
      {has ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, per-user thumbnails
        <img
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(src)}
          className={cn(
            "size-full object-cover",
            kind && TOP.has(kind) && "object-top"
          )}
        />
      ) : (
        children
      )}
    </div>
  )
}
