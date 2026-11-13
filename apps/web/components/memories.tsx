"use client"

import { Menu } from "@base-ui/react/menu"
import {
  CalendarBlankIcon,
  DotsThreeIcon,
  EyeSlashIcon,
  FolderSimpleIcon,
  ImageIcon,
  PlayIcon,
  UserIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { setPersonMemories } from "@/app/(app)/people-actions"
import { getMemories, hideFromMemories, showInMemories } from "@/app/(app)/photo-actions"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { Slideshow, type Slide } from "@/components/slideshow"
import { Thumb } from "@/components/thumb"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { IMAGE } from "@/lib/file-rules"
import type { PhotoItem } from "@nimbus/shared/api"
import { cn } from "@/lib/utils"

// "2026-11-12" in the browser's own time zone: a memory is about the viewer's today.
const localDate = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const ago = (n: number) => (n === 1 ? "1 year ago" : `${n} years ago`)

// "Hide this photo / day / folder" from memories, with Undo in the toast. On a
// "With X" card, also "No memories of X" (back on from their People page).
export function HideMenu({
  photo,
  person,
  onChange,
  className,
}: {
  photo: PhotoItem
  person?: { id: string; name: string }
  onChange: () => void
  className?: string
}) {
  const notice = useNotice()
  async function hidePerson(p: { id: string; name: string }) {
    const res = await setPersonMemories(p.id, false)
    if ("error" in res && res.error) return notice({ text: res.error, error: true })
    onChange()
    notice({
      text: `No more memories of ${p.name}.`,
      undo: () => void setPersonMemories(p.id, true).then(onChange),
    })
  }
  async function hide(what: "photo" | "day" | "folder") {
    const day = photo.takenAt.slice(5, 10)
    const res = await hideFromMemories(
      what === "day"
        ? { kind: "day", day }
        : { kind: what, nodeId: what === "photo" ? photo.id : (photo.folderId ?? undefined) }
    )
    if (res.error) return notice({ text: res.error, error: true })
    const id = res.id
    onChange()
    notice({
      text:
        what === "photo"
          ? "Hidden from memories."
          : what === "day"
            ? "This day is hidden from memories."
            : "This folder is hidden from memories.",
      undo: id
        ? () => void showInMemories(id).then(onChange)
        : undefined,
    })
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide from memories"
            className={className}
          />
        }
      >
        <DotsThreeIcon weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-[70]">
          <Menu.Popup className={cn("w-52", MENU_POPUP)}>
            <Menu.Item className={MENU_ITEM} onClick={() => hide("photo")}>
              <EyeSlashIcon />
              Hide this photo
            </Menu.Item>
            <Menu.Item className={MENU_ITEM} onClick={() => hide("day")}>
              <CalendarBlankIcon />
              Hide this day
            </Menu.Item>
            {photo.folderId && (
              <Menu.Item className={MENU_ITEM} onClick={() => hide("folder")}>
                <FolderSimpleIcon />
                Hide this folder
              </Menu.Item>
            )}
            {person && (
              <Menu.Item className={MENU_ITEM} onClick={() => hidePerson(person)}>
                <UserIcon />
                No memories of {person.name}
              </Menu.Item>
            )}
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.LinkItem render={<Link href="/photos/hidden" />} className={MENU_ITEM}>
              Hidden from memories…
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

type Card = { key: string; title: string; sub: string; items: PhotoItem[]; person?: { id: string; name: string } }

// One card per past year for today's date, and "With Priya, 2024" cards for named people.
// Hidden when there are none.
export function MemoriesStrip() {
  const [cards, setCards] = useState<Card[]>([])
  const [withPeople, setWithPeople] = useState(false)
  const [play, setPlay] = useState<number | null>(null)

  const load = useCallback(() => {
    getMemories(localDate()).then(
      (r) => {
        setWithPeople(Boolean(r.people?.length))
        setCards([
          ...r.years.map((y) => ({ key: `year-${y.year}`, title: ago(y.yearsAgo), sub: String(y.year), items: y.items })),
          ...(r.people ?? []).map((m) => ({
            key: `person-${m.personId}-${m.year}`,
            title: `With ${m.name}`,
            sub: String(m.year),
            items: m.items,
            person: { id: m.personId, name: m.name },
          })),
        ])
      },
      () => {}
    )
  }, [])
  useEffect(load, [load])

  // Title card, then that card's photos (videos are skipped, they don't fit a slideshow).
  const { slides, starts } = useMemo(() => {
    const slides: Slide[] = []
    const starts: number[] = []
    for (const c of cards) {
      const photos = c.items.filter((p) => IMAGE.test(p.name))
      if (!photos.length) {
        starts.push(-1)
        continue
      }
      starts.push(slides.length)
      slides.push({ id: c.key, title: c.title, sub: c.sub })
      for (const p of photos) slides.push({ id: p.id, item: p })
    }
    return { slides, starts }
  }, [cards])

  if (!cards.length) return null
  const all = cards.flatMap((c) => c.items)
  return (
    <section aria-labelledby="otd" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id="otd" className="flex-1 text-sm font-medium">
          {withPeople ? "Memories" : "On this day"}
        </h2>
        {slides.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setPlay(0)}>
            <PlayIcon weight="fill" />
            Play all
          </Button>
        )}
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        {cards.map((c, n) => {
          const cover = c.items[0]
          return (
            <li key={c.key} className="group relative w-36 shrink-0 snap-start sm:w-40">
              <button
                type="button"
                disabled={starts[n] < 0}
                onClick={() => setPlay(starts[n])}
                className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-muted/40 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Thumb item={cover} make={false} className="absolute inset-0 transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none">
                  <ImageIcon weight="light" className="absolute inset-0 m-auto size-8 text-muted-foreground" />
                </Thumb>
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-10 text-white">
                  <span className="block truncate text-sm font-semibold">{c.title}</span>
                  <span className="block text-xs text-white/75 tabular-nums">
                    {c.sub} · {c.items.length} {c.items.length === 1 ? "photo" : "photos"}
                  </span>
                </span>
              </button>
              <HideMenu
                photo={cover}
                person={c.person}
                onChange={load}
                className="absolute top-1.5 right-1.5 bg-black/45 text-white opacity-0 hover:bg-black/60 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 max-sm:opacity-100"
              />
            </li>
          )
        })}
      </ul>
      {play !== null && (
        <Slideshow
          slides={slides}
          start={play}
          onClose={() => setPlay(null)}
          actions={(s) => {
            const p = s.item ? all.find((x) => x.id === s.item.id) : undefined
            return p && <HideMenu photo={p} onChange={load} className="text-white hover:bg-white/15 hover:text-white" />
          }}
        />
      )}
    </section>
  )
}
