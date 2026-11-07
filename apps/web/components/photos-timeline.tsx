"use client"

import {
  ImageIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlayIcon,
} from "@phosphor-icons/react"
import { groupByMonth, monthTitle } from "@nimbus/shared/photos"
import { useMemo, useState } from "react"

import { Previewer } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import { VIDEO } from "@/lib/file-rules"
import type { PhotoItem } from "@nimbus/shared/api"

type Page = { items: PhotoItem[]; total: number; nextCursor: string | null }

// Square tiles per row, from big to small.
const ZOOMS = [3, 5, 7, 9]

// Every photo and video of mine by date taken, month by month. The same
// endpoint as the app's Photos tab.
export function PhotosTimeline({ first }: { first: Page }) {
  const [items, setItems] = useState(first.items)
  const [cursor, setCursor] = useState(first.nextCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const groups = useMemo(() => groupByMonth(items), [items])

  async function more() {
    if (!cursor || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/v1/photos?limit=500&cursor=${encodeURIComponent(cursor)}`)
      if (!res.ok) throw new Error()
      const page: Page = await res.json()
      setItems((have) => [...have, ...page.items.filter((p) => !have.some((h) => h.id === p.id))])
      setCursor(page.nextCursor)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }

  const shown = open === null ? null : items[open]
  // Stepping to the end of what's loaded asks for the next page.
  const step = (by: number) => () => {
    if (open === null) return
    const next = open + by
    if (next < 0 || next >= items.length) return
    setOpen(next)
    if (next >= items.length - 3) void more()
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Photos</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {first.total.toLocaleString()} photos and videos
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Larger photos"
            disabled={zoom === 0}
            onClick={() => setZoom(zoom - 1)}
          >
            <MagnifyingGlassPlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Smaller photos"
            disabled={zoom === ZOOMS.length - 1}
            onClick={() => setZoom(zoom + 1)}
          >
            <MagnifyingGlassMinusIcon />
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="max-w-sm space-y-1">
            <ImageIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">No photos yet</p>
            <p className="text-sm text-muted-foreground">
              Photos and videos you upload show up here, newest first. Your Vaults and Trash are left out.
            </p>
          </div>
        </div>
      ) : (
        groups.map((g, gi) => {
          const before = groups.slice(0, gi).reduce((n, x) => n + x.items.length, 0)
          return (
            <section key={`${g.key}-${gi}`} aria-label={monthTitle(g.key)}>
              <h2 className="sticky top-0 z-10 bg-background/90 py-2 text-sm font-medium backdrop-blur">
                {monthTitle(g.key)}
              </h2>
              <ul
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${ZOOMS[zoom]}, minmax(0, 1fr))` }}
              >
                {g.items.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(before + i)}
                      aria-label={p.name}
                      className="relative block aspect-square w-full overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}

      {cursor && (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={more} disabled={loading}>
            {loading ? "Loading…" : failed ? "Couldn't load. Try again" : "Load more"}
          </Button>
        </div>
      )}

      <Previewer
        shown={shown ? { item: shown } : null}
        open={shown != null}
        onClose={() => setOpen(null)}
        onPrev={open ? step(-1) : undefined}
        onNext={open !== null && open < items.length - 1 ? step(1) : undefined}
        position={shown ? `${open! + 1} of ${first.total}` : undefined}
      />
    </div>
  )
}
