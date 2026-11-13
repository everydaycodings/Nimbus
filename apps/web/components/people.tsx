"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowLeftIcon,
  CheckIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  GitMergeIcon,
  PencilSimpleIcon,
  SparkleIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAi } from "@/components/ai-context"
import {
  answerSuggestion,
  assignFace,
  getFileFaces,
  getPeople,
  getSuggestions,
  hidePerson,
  mergePerson,
  renamePerson,
  setPersonMemories,
} from "@/app/(app)/people-actions"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { makeStore, useStore } from "@/lib/media-extras"
import { cn } from "@/lib/utils"
import type { FileFace, PersonSuggestion, PhotoPerson } from "@nimbus/shared/api"

// ---- Who's in my photos, shared by the chips, the avatar row and the pickers ----

const store = makeStore<{ people: PhotoPerson[] | null }>({ people: null })
let asked = false
const reload = () =>
  getPeople().then(
    (r) => store.set({ people: r.people }),
    () => {}
  )
// After a rename, hide, merge or new face: chips and rows read the list again.
export const refreshPeople = () => void reload()

// My visible people (named first); null until loaded, and when face grouping is off.
export function usePeople() {
  const on = useAi().facesOn
  const { people } = useStore(store)
  useEffect(() => {
    if (on && !asked) {
      asked = true
      void reload()
    }
  }, [on])
  return on ? people : null
}

export const personName = (p: Pick<PhotoPerson, "name">) => p.name ?? "Unnamed"

// A face, cropped (GET /faces/{id}/crop) or a person's cover; a plain head when there is none.
export function Face({
  src,
  className,
  alt = "",
}: {
  src: string | null
  className?: string
  alt?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground",
        className
      )}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small webp from our own API
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <UserIcon weight="fill" className="size-1/2" />
      )}
    </span>
  )
}

export const personFace = (p: PhotoPerson) => (p.coverFaceId ? `/api/v1/people/${p.id}/cover` : null)

const photosText = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`

// ---- Photos: the avatar row under Memories ----

export function PeopleRow() {
  const people = usePeople()
  if (!people?.length) return null
  return (
    <section aria-labelledby="people-row" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id="people-row" className="flex-1 text-sm font-medium">
          People
        </h2>
        <Link
          href="/photos/people"
          className="rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          See all
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        {people.slice(0, 14).map((p) => (
          <li key={p.id} className="w-16 shrink-0 snap-start sm:w-[4.5rem]">
            <Link
              href={`/photos/people/${p.id}`}
              className="group flex flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Face
                src={personFace(p)}
                className="size-14 ring-offset-2 ring-offset-background transition-shadow group-hover:ring-2 group-hover:ring-brand/60 sm:size-16"
              />
              <span
                className={cn(
                  "w-full truncate text-center text-xs",
                  p.name ? "text-foreground" : "text-muted-foreground italic"
                )}
              >
                {p.name ?? "Add name"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- People page ----

export function PeopleGrid({
  people,
  hiddenCount,
  showingHidden,
}: {
  people: PhotoPerson[]
  hiddenCount: number
  showingHidden: boolean
}) {
  return (
    <>
      {people.length === 0 ? (
        <div className="grid flex-1 place-items-center py-16 text-center">
          <div className="max-w-sm space-y-1">
            <UserIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">{showingHidden ? "No hidden people" : "No people yet"}</p>
            <p className="text-sm text-muted-foreground">
              {showingHidden
                ? "People you hide from this page show up here, so you can bring them back."
                : "Nimbus groups the faces in your photos in the background, so people show up here as it goes. Large libraries can take a while."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
          {people.map((p) => (
            <li key={p.id}>
              <Link
                href={`/photos/people/${p.id}`}
                className="group flex flex-col items-center gap-2 rounded-xl p-1 text-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Face
                  src={personFace(p)}
                  className="aspect-square w-full max-w-32 transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
                <span className="grid w-full gap-0.5">
                  <span className={cn("truncate text-sm font-medium", !p.name && "text-muted-foreground italic")}>
                    {p.name ?? "Add a name"}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {photosText(p.photos)}
                    {p.suggestions > 0 && <span className="text-brand"> · {p.suggestions} to review</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!showingHidden && hiddenCount > 0 && (
        <Link
          href="/photos/people?hidden=1"
          className="self-start rounded-md px-2 py-1 text-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Hidden people ({hiddenCount})
        </Link>
      )}
    </>
  )
}

// ---- Picking a person: Merge into…, Move to…, naming a face ----

// A filterable list of people, for merging or moving. `onPick(null)` is "a new person".
export function PersonPicker({
  open,
  onClose,
  title,
  description,
  exclude,
  newLabel,
  onPick,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  exclude: string
  newLabel?: string
  onPick: (personId: string | null) => void
}) {
  const [list, setList] = useState<PhotoPerson[] | null>(null)
  const [q, setQ] = useState("")
  useEffect(() => {
    if (!open) return
    let live = true
    getPeople().then(
      (r) => live && setList(r.people.filter((p) => p.id !== exclude)),
      () => live && setList([])
    )
    return () => {
      live = false
    }
  }, [open, exclude])
  const shown = (list ?? []).filter((p) => !q.trim() || p.name?.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onOpenChangeComplete={(o) => !o && setQ("")}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {description}
            </Dialog.Description>
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find a person"
            placeholder="Find a person"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <ul className="-mx-2 flex max-h-72 flex-col overflow-y-auto">
            {newLabel && (
              <li>
                <button
                  type="button"
                  onClick={() => onPick(null)}
                  className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Face src={null} className="size-9" />
                  {newLabel}
                </button>
              </li>
            )}
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Face src={personFace(p)} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", !p.name && "text-muted-foreground italic")}>
                      {p.name ?? "Unnamed"}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{photosText(p.photos)}</span>
                  </span>
                </button>
              </li>
            ))}
            {list === null && <li className="px-2 py-3 text-sm text-muted-foreground">Loading…</li>}
            {list && !shown.length && (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                {q.trim() ? `Nobody named “${q.trim()}”.` : "There's nobody else yet."}
              </li>
            )}
          </ul>
          <div className="flex justify-end">
            <Dialog.Close render={<Button variant="outline" />}>Cancel</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---- A person's page: the name, hide and merge ----

export function PersonHeader({ person, shown }: { person: PhotoPerson; shown: number }) {
  const router = useRouter()
  const notice = useNotice()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(person.name ?? "")
  const [merging, setMerging] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    const next = name.trim()
    setEditing(false)
    if (next === (person.name ?? "")) return
    const r = await renamePerson(person.id, next || null)
    if (r.error) return notice({ text: r.error, error: true })
    refreshPeople()
    router.refresh()
  }
  async function hide(hidden: boolean) {
    setBusy(true)
    const r = await hidePerson(person.id, hidden)
    setBusy(false)
    if (r.error) return notice({ text: r.error, error: true })
    refreshPeople()
    notice({
      text: hidden ? `${person.name ?? "This person"} is hidden from People.` : "Back in People.",
      undo: () => void hide(!hidden),
    })
    router.refresh()
  }
  async function memories(on: boolean) {
    setBusy(true)
    const r = await setPersonMemories(person.id, on)
    setBusy(false)
    if (r.error) return notice({ text: r.error, error: true })
    notice({ text: on ? "Memories of them are back." : "No more memories of them.", undo: () => void memories(!on) })
    router.refresh()
  }
  async function merge(intoId: string | null) {
    if (!intoId) return
    setMerging(false)
    const r = await mergePerson(person.id, intoId)
    if (r.error) return notice({ text: r.error, error: true })
    refreshPeople()
    notice({ text: "Merged." })
    router.push(`/photos/people/${intoId}`)
  }

  return (
    <div className="flex min-w-0 flex-auto items-center gap-3">
      <Link
        href="/photos/people"
        aria-label="Back to People"
        className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon />
      </Link>
      <Face src={personFace(person)} className="size-12" />
      <div className="min-w-0 flex-auto">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={name}
              maxLength={80}
              aria-label="Name"
              placeholder="Add a name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  setName(person.name ?? "")
                  setEditing(false)
                }
              }}
              className="h-9 w-full max-w-64 rounded-md border border-input bg-transparent px-2.5 text-lg font-semibold tracking-tight outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name" onMouseDown={(e) => e.preventDefault()}>
              <CheckIcon />
            </Button>
          </form>
        ) : (
          <h1 className="min-w-0">
            <button
              type="button"
              onClick={() => {
                setName(person.name ?? "")
                setEditing(true)
              }}
              title="Rename"
              className="group/name -mx-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-2xl font-semibold tracking-tight outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className={cn("truncate", !person.name && "text-muted-foreground")}>
                {person.name ?? "Add a name"}
              </span>
              <PencilSimpleIcon className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100 pointer-coarse:opacity-100" />
            </button>
          </h1>
        )}
        <p className="text-sm text-muted-foreground tabular-nums">
          {photosText(shown)}
          {person.hidden && " · Hidden from People"}
          {person.name && !person.memories && " · Not in memories"}
        </p>
      </div>
      <Menu.Root>
        <Menu.Trigger render={<Button variant="ghost" size="icon" aria-label="More for this person" disabled={busy} />}>
          <DotsThreeIcon weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className={cn("w-52", MENU_POPUP)}>
              <Menu.Item className={MENU_ITEM} onClick={() => setMerging(true)}>
                <GitMergeIcon />
                Merge into…
              </Menu.Item>
              <Menu.Item className={MENU_ITEM} onClick={() => void hide(!person.hidden)}>
                {person.hidden ? <EyeIcon /> : <EyeSlashIcon />}
                {person.hidden ? "Show in People" : "Hide from People"}
              </Menu.Item>
              {person.name && (
                <Menu.Item className={MENU_ITEM} onClick={() => void memories(!person.memories)}>
                  <SparkleIcon />
                  {person.memories ? "No memories of them" : "Show in memories"}
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <PersonPicker
        open={merging}
        onClose={() => setMerging(false)}
        title={`Merge ${person.name ?? "this person"} into…`}
        description="All their photos join the person you pick, and this person goes away. If they are the same person, that is what you want."
        exclude={person.id}
        onPick={merge}
      />
    </div>
  )
}

// ---- "Is this X?": yes or no per face ----

export function SuggestionsStrip({ person, onAnswered }: { person: PhotoPerson; onAnswered: () => void }) {
  const notice = useNotice()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<PersonSuggestion[] | null>(null)
  const [yes, setYes] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const label = person.name ?? "this person"

  useEffect(() => {
    if (!open || list) return
    let live = true
    getSuggestions(person.id).then(
      (r) => live && setList(r ?? []),
      () => live && setList([])
    )
    return () => {
      live = false
    }
  }, [open, list, person.id])

  async function answer(s: PersonSuggestion, accept: boolean) {
    setBusy(s.faceId)
    const r = await answerSuggestion(s.faceId, accept)
    setBusy(null)
    if (r.error) return notice({ text: r.error, error: true })
    if (accept) setYes((n) => n + 1)
    setList((l) => (l ?? []).filter((x) => x.faceId !== s.faceId))
  }
  function close() {
    setOpen(false)
    // Photos that were confirmed now belong in the grid.
    if (yes) onAnswered()
  }

  if (person.suggestions === 0 && !open) return null
  return (
    <section aria-label="Suggestions" className="rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm">
          {open && list && !list.length
            ? "All reviewed."
            : `${person.suggestions} ${person.suggestions === 1 ? "face looks" : "faces look"} like ${label}.`}
        </p>
        {open ? (
          <Button variant="ghost" size="sm" onClick={close}>
            Done
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Review {person.suggestions} {person.suggestions === 1 ? "suggestion" : "suggestions"}
          </Button>
        )}
      </div>
      {open && (
        <ul className="mt-3 flex snap-x gap-3 overflow-x-auto pb-1">
          {list === null && <li className="text-sm text-muted-foreground">Loading…</li>}
          {(list ?? []).map((s) => (
            <li key={s.faceId} className="flex w-28 shrink-0 snap-start flex-col items-center gap-2 rounded-lg border bg-background p-2">
              <Face src={`/api/v1/faces/${s.faceId}/crop`} className="size-20" alt={`Possibly ${label}`} />
              <p className="text-center text-xs text-muted-foreground">Is this {person.name ?? "them"}?</p>
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Yes, this is ${label}`}
                  disabled={busy === s.faceId}
                  onClick={() => void answer(s, true)}
                >
                  <CheckIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`No, this is not ${label}`}
                  disabled={busy === s.faceId}
                  onClick={() => void answer(s, false)}
                >
                  <XIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Details › People ----

// The faces found in one photo: names, "Is this X?", and naming an unnamed one. Own photos only.
export function FilePeople({ id }: { id: string }) {
  const on = useAi().facesOn
  const notice = useNotice()
  const [loaded, setLoaded] = useState<{ id: string; faces: FileFace[] } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const faces = loaded?.id === id ? loaded.faces : undefined

  function load() {
    return getFileFaces(id).then((f) => setLoaded({ id, faces: f }), () => setLoaded({ id, faces: [] }))
  }
  useEffect(() => {
    if (!on) return
    let live = true
    getFileFaces(id).then(
      (f) => live && setLoaded({ id, faces: f }),
      () => live && setLoaded({ id, faces: [] })
    )
    return () => {
      live = false
    }
  }, [id, on])

  async function done(task: Promise<{ error: string } | { person: PhotoPerson }>) {
    const r = await task
    if ("error" in r) return notice({ text: r.error, error: true })
    setNaming(null)
    refreshPeople()
    await load()
  }

  if (!on || !faces?.length) return null
  return (
    <section aria-labelledby="file-people" className="flex flex-col gap-3">
      <h3 id="file-people" className="text-sm font-medium">
        People
      </h3>
      <ul className="flex flex-wrap gap-x-3 gap-y-4">
        {faces.map((f) => (
          <li key={f.id} className="flex w-[4.5rem] flex-col items-center gap-1.5 text-center">
            {f.personId ? (
              <Link
                href={`/photos/people/${f.personId}`}
                className="flex flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Face src={`/api/v1/faces/${f.id}/crop`} className="size-14" />
                <span className={cn("w-full truncate text-xs", !f.personName && "text-muted-foreground italic")}>
                  {f.personName ?? "Unnamed"}
                </span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setNaming(naming === f.id ? null : f.id)}
                aria-expanded={naming === f.id}
                aria-label="Name this person"
                className="flex flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Face src={`/api/v1/faces/${f.id}/crop`} className={cn("size-14", naming === f.id && "ring-2 ring-brand")} />
                <span className="w-full truncate text-xs text-muted-foreground">
                  {f.suggestion ? `Is this ${f.suggestion.name ?? "them"}?` : "Who's this?"}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {faces.some((f) => f.id === naming) && naming && (
        <NameFace
          key={naming}
          suggestion={faces.find((f) => f.id === naming)?.suggestion ?? null}
          onAnswer={(accept) => done(answerSuggestion(naming, accept))}
          onPick={(to) => done(assignFace(naming, to))}
          onCancel={() => setNaming(null)}
        />
      )}
    </section>
  )
}

// Type a name to start a person, or pick someone who already exists.
function NameFace({
  suggestion,
  onAnswer,
  onPick,
  onCancel,
}: {
  suggestion: FileFace["suggestion"]
  onAnswer: (accept: boolean) => void
  onPick: (to: { personId: string } | { name: string }) => void
  onCancel: () => void
}) {
  const [people, setPeople] = useState<PhotoPerson[] | null>(null)
  const [q, setQ] = useState("")
  useEffect(() => {
    let live = true
    getPeople().then(
      (r) => live && setPeople(r.people.filter((p) => p.name)),
      () => live && setPeople([])
    )
    return () => {
      live = false
    }
  }, [])
  const name = q.trim()
  const matches = (people ?? []).filter((p) => !name || p.name!.toLowerCase().includes(name.toLowerCase())).slice(0, 5)
  const exact = (people ?? []).some((p) => p.name!.toLowerCase() === name.toLowerCase())
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      {suggestion && (
        <div className="flex items-center gap-2 border-b pb-2">
          <p className="flex-1 text-sm">Is this {suggestion.name ?? "them"}?</p>
          <Button size="xs" onClick={() => onAnswer(true)}>
            Yes
          </Button>
          <Button size="xs" variant="outline" onClick={() => onAnswer(false)}>
            No
          </Button>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name) onPick({ name })
        }}
      >
        <input
          autoFocus
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Name"
          placeholder="Name this person"
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" size="sm" className="h-8" disabled={!name || exact}>
          Add
        </Button>
      </form>
      {people === null ? (
        <span className="h-4 w-24 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
      ) : (
        matches.length > 0 && (
          <ul aria-label="People you named" className="flex flex-col">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick({ personId: p.id })}
                  className="flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Face src={personFace(p)} className="size-7" />
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
