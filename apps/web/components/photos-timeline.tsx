"use client"

import {
  CheckIcon,
  CheckSquareIcon,
  ImageIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlayIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { groupByMonth, monthTitle } from "@nimbus/shared/photos"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { updatePartner } from "@/app/(app)/photo-actions"
import { moveFaces, notPerson, personFaceIds } from "@/app/(app)/people-actions"
import { useAi } from "@/components/ai-context"
import { DetailsSheet } from "@/components/details-sheet"
import { MemoriesStrip } from "@/components/memories"
import {
  PeopleRow,
  PersonHeader,
  PersonPicker,
  SuggestionsStrip,
  personName,
  refreshPeople,
  usePeople,
} from "@/components/people"
import { Previewer } from "@/components/previewer"
import { Slideshow } from "@/components/slideshow"
import type { PlaceStart } from "@/components/text-places"
import { Thumb } from "@/components/thumb"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { IMAGE, VIDEO } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import type { PartnerShare, PhotoItem, PhotoPerson, SmartGroup } from "@nimbus/shared/api"

type Page = { items: PhotoItem[]; total: number; nextCursor: string | null }

const GROUPS: { id: SmartGroup; label: string; empty: string }[] = [
  { id: "screenshots", label: "Screenshots", empty: "Screenshots of your screen show up here." },
  { id: "documents", label: "Documents", empty: "Scans and pictures of pages show up here." },
  { id: "receipts", label: "Receipts", empty: "Pictures of receipts and invoices show up here." },
  { id: "videos", label: "Videos", empty: "Your videos show up here." },
]

// Photos' own navigation: the timeline, albums, the map and the smart groups.
export function PhotoChips({ active, mapOn }: { active: string; mapOn: boolean }) {
  const faces = useAi().facesOn
  const named = (usePeople() ?? []).filter((p) => p.name).slice(0, 5)
  const chips = [
    { id: "all", label: "All photos", href: "/photos" },
    { id: "albums", label: "Albums", href: "/photos/albums" },
    ...(mapOn ? [{ id: "places", label: "Places", href: "/photos/places" }] : []),
    ...(faces ? [{ id: "people", label: "People", href: "/photos/people" }] : []),
    ...GROUPS.map((g) => ({ id: g.id, label: g.label, href: `/photos/smart/${g.id}` })),
    ...named.map((p) => ({ id: `person:${p.id}`, label: p.name!, href: `/photos/people/${p.id}` })),
  ]
  // With person chips the row can run past the screen: bring the current one into view.
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const cur = nav.current?.querySelector<HTMLElement>("[aria-current=page]")
    if (cur && nav.current) nav.current.scrollLeft = cur.offsetLeft - nav.current.clientWidth / 2 + cur.clientWidth / 2
  }, [active, named.length])
  return (
    <nav
      ref={nav}
      aria-label="Photo groups"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((c) => (
        <Link
          key={c.id}
          href={c.href}
          aria-current={c.id === active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center rounded-full border px-3.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            c.id === active
              ? "border-transparent bg-primary text-primary-foreground"
              : "bg-background hover:bg-muted"
          )}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  )
}

// Square tiles per row, from big to small.
const ZOOMS = [3, 5, 7, 9]

// Every photo and video of mine by date taken, month by month. The same
// endpoint as the app's Photos tab.
export function PhotosTimeline({
  first,
  group,
  mapOn,
  partners = [],
  person,
}: {
  first: Page
  // A smart group's page: the same grid over `/photos/smart/<group>`.
  group?: SmartGroup
  mapOn: boolean
  // Active partners who share with me (to offer the show/hide switch).
  partners?: PartnerShare[]
  // A person's page: the same grid over `/people/<id>`, with their name, review and select tools.
  person?: PhotoPerson
}) {
  const router = useRouter()
  const notice = useNotice()
  const base = person ? `/api/v1/people/${person.id}` : group ? `/api/v1/photos/smart/${group}` : "/api/v1/photos"
  const [partnersHidden, setPartnersHidden] = useState(partners.every((p) => p.hidden))
  const [total, setTotal] = useState(first.total)
  const [slides, setSlides] = useState(false)
  const [items, setItems] = useState(first.items)
  const [cursor, setCursor] = useState(first.nextCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [start, setStart] = useState<PlaceStart | undefined>()
  const [details, setDetails] = useState<PhotoItem | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  // A person's page: pick photos to take them off this person, or move them to another.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const groups = useMemo(() => groupByMonth(items), [items])

  async function more() {
    if (!cursor || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`${base}?limit=500&cursor=${encodeURIComponent(cursor)}`)
      if (!res.ok) throw new Error()
      const page: Page = await res.json()
      setItems((have) => [...have, ...page.items.filter((p) => !have.some((h) => h.id === p.id))])
      setCursor(page.nextCursor)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }

  // The switch hides or shows partners' photos, then the list starts over.
  async function togglePartners() {
    const hidden = !partnersHidden
    setPartnersHidden(hidden)
    await Promise.all(partners.map((p) => updatePartner({ userId: p.person.id, hidden })))
    const res = await fetch(`${base}?limit=500`)
    if (!res.ok) return
    const page: Page = await res.json()
    setItems(page.items)
    setCursor(page.nextCursor)
    setTotal(page.total)
  }

  // Faces belong to photos, not the other way round: look up this person's face in each picked photo.
  async function fix(task: (faceIds: string[]) => Promise<unknown>, done: string) {
    if (!person || !picked?.size) return
    setBusy(true)
    const faceIds = await personFaceIds(person.id, [...picked])
    const r = faceIds.length ? await task(faceIds) : { error: "Those photos aren't available anymore." }
    setBusy(false)
    setMoving(false)
    const error = (r as { error?: string }).error
    if (error) return notice({ text: error, error: true })
    setPicked(null)
    refreshPeople()
    notice({ text: done })
    router.refresh()
  }

  const stills = items.filter((p) => IMAGE.test(p.name))
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
        {person ? (
          <PersonHeader person={person} shown={total} />
        ) : (
          <div className="min-w-0 flex-auto">
            <h1 className="text-2xl font-semibold tracking-tight">
              {GROUPS.find((g) => g.id === group)?.label ?? "Photos"}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {total.toLocaleString()} photos and videos
            </p>
          </div>
        )}
        <div className="flex items-center gap-1">
          {partners.length > 0 && !group && (
            <label className="mr-1 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={!partnersHidden}
                onChange={togglePartners}
                className="size-4 accent-primary"
              />
              Show partner photos
            </label>
          )}
          {person && (
            <Button
              variant={picked ? "secondary" : "ghost"}
              size="sm"
              disabled={!items.length}
              aria-pressed={Boolean(picked)}
              onClick={() => setPicked(picked ? null : new Set())}
            >
              <CheckSquareIcon />
              {picked ? "Cancel" : "Select"}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!stills.length} onClick={() => setSlides(true)}>
            <PlayIcon weight="fill" />
            Slideshow
          </Button>
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

      <PhotoChips active={person ? `person:${person.id}` : (group ?? "all")} mapOn={mapOn} />
      {!group && !person && <MemoriesStrip />}
      {!group && !person && <PeopleRow />}
      {person?.hidden && (
        <p className="rounded-xl border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {personName(person)} is hidden, so they are left out of People and the chips. Use the menu to show them again.
        </p>
      )}
      {person && <SuggestionsStrip person={person} onAnswered={() => router.refresh()} />}

      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="max-w-sm space-y-1">
            <ImageIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">{person ? "No photos left" : group ? `No ${GROUPS.find((g) => g.id === group)!.label.toLowerCase()} yet` : "No photos yet"}</p>
            <p className="text-sm text-muted-foreground">
              {person
                ? "Every photo of this person was moved or removed. Review suggestions above may bring some back."
                : group
                ? `${GROUPS.find((g) => g.id === group)!.empty} Sorting runs in the background, so new uploads can take a few minutes.`
                : "Photos and videos you upload show up here, newest first. Your Vaults and Trash are left out."}
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
                      onClick={() =>
                        picked
                          ? setPicked((have) => {
                              const next = new Set(have)
                              if (!next.delete(p.id)) next.add(p.id)
                              return next
                            })
                          : (setStart(undefined), setOpen(before + i))
                      }
                      aria-label={p.name}
                      aria-pressed={picked ? picked.has(p.id) : undefined}
                      className="relative block aspect-square w-full overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Thumb item={p} make={false} className="absolute inset-0">
                        <ImageIcon weight="light" className="absolute inset-0 m-auto size-8 text-muted-foreground" />
                      </Thumb>
                      {p.fromPartner && (
                        <span
                          title={`From ${p.owner}`}
                          className="absolute bottom-1 left-1 flex max-w-[calc(100%-2.5rem)] items-center gap-1 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-[11px] text-white"
                        >
                          <UsersIcon weight="fill" className="size-3 shrink-0" />
                          <span className="truncate">{p.owner}</span>
                        </span>
                      )}
                      {picked && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full border-2 border-white shadow transition-colors",
                            picked.has(p.id) ? "bg-brand text-white" : "bg-black/30"
                          )}
                        >
                          {picked.has(p.id) && <CheckIcon weight="bold" className="size-3.5" />}
                        </span>
                      )}
                      {picked?.has(p.id) && <span aria-hidden className="absolute inset-0 ring-4 ring-inset ring-brand/70" />}
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
        position={shown ? `${open! + 1} of ${total}` : undefined}
        start={start}
        onDetails={shown ? () => (setDetails(shown), setDetailsOpen(true)) : undefined}
      />
      <DetailsSheet
        item={details}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        tags={null}
        editable={Boolean(details && !details.fromPartner)}
        onTag={() => {}}
        onNewTag={() => {}}
        onSeek={(s) => {
          setStart(s)
          setDetailsOpen(false)
        }}
      />
      {picked && (
        <div
          role="toolbar"
          aria-label="Selected photos"
          className="sticky bottom-4 z-20 mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border bg-popover p-2 pl-4 text-popover-foreground shadow-lg"
        >
          <span className="text-sm tabular-nums" aria-live="polite">
            {picked.size ? `${picked.size} selected` : "Pick photos"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!picked.size || busy}
            onClick={() => void fix((ids) => notPerson(person!.id, ids), `Taken off ${person!.name ?? "this person"}.`)}
          >
            Not {person!.name ?? "this person"}
          </Button>
          <Button variant="outline" size="sm" disabled={!picked.size || busy} onClick={() => setMoving(true)}>
            Move to…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
            Cancel
          </Button>
        </div>
      )}
      {person && (
        <PersonPicker
          open={moving}
          onClose={() => setMoving(false)}
          title={`Move ${picked?.size ?? 0} ${picked?.size === 1 ? "photo" : "photos"} to…`}
          description={`These photos' faces leave ${person.name ?? "this person"} and join the person you pick.`}
          exclude={person.id}
          newLabel="A new person"
          onPick={(to) => void fix((ids) => moveFaces(person.id, ids, to), "Moved.")}
        />
      )}
      {slides && (
        <Slideshow
          slides={stills.map((p) => ({ id: p.id, item: p }))}
          onClose={() => setSlides(false)}
        />
      )}
    </div>
  )
}
