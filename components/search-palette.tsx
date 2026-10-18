"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  FileArrowUpIcon,
  FolderIcon,
  FolderSimplePlusIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  StarIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"

import { quickSearch } from "@/app/(app)/search-actions"
import { DIALOG_BACKDROP } from "@/components/overlay-styles"
import { Previewer } from "@/components/previewer"
import { startNewFolder, usePick } from "@/components/upload-provider"
import { fileType } from "@/lib/file-types"
import type { Hit } from "@/lib/files"
import { cn } from "@/lib/utils"

const RECENT_KEY = "nimbus-searches"

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []
  } catch {
    return []
  }
}

function remember(q: string) {
  const s = q.trim()
  if (!s) return
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([s, ...loadRecent().filter((r) => r !== s)].slice(0, 6))
    )
  } catch {}
}

// ts_headline marks matches with \u0001…\u0002.
function Snippet({ text }: { text: string }) {
  return text.split("\u0001").map((part, i) => {
    const [hit, rest] = part.includes("\u0002")
      ? part.split("\u0002")
      : ["", part]
    return (
      <Fragment key={i}>
        {hit && (
          <mark className="rounded-sm bg-brand/20 text-foreground">{hit}</mark>
        )}
        {rest}
      </Fragment>
    )
  })
}

type Row = {
  key: string
  label: React.ReactNode
  icon: Icon
  iconClass?: string
  detail?: React.ReactNode
  run: () => void
}

// The header's search: names and text inside files as you type, recent
// searches, and app commands. Ctrl+K opens it from anywhere.
export function SearchPalette({ admin }: { admin: boolean }) {
  const router = useRouter()
  const pick = usePick()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [found, setFound] = useState<{ q: string; hits: Hit[] } | null>(null)
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const [hasLayout, setHasLayout] = useState(false)
  const [previewing, setPreviewing] = useState<Hit | null>(null)
  const list = useRef<HTMLUListElement>(null)

  function show() {
    setRecent(loadRecent())
    setHasLayout(
      Boolean(document.querySelector('[role=group][aria-label="Layout"]'))
    )
    setQ("")
    setFound(null)
    setActive(0)
    setOpen(true)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault()
        document.getElementById("search-trigger")?.click()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const query = q.trim()
  useEffect(() => {
    if (!query) return
    let live = true
    const t = setTimeout(
      () =>
        quickSearch(query).then(
          (hits) => live && setFound({ q: query, hits }),
          () => live && setFound({ q: query, hits: [] })
        ),
      120
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  // Runs once the palette has closed, so dialogs it opens get focus.
  const then = (fn: () => void) => () => {
    setOpen(false)
    setTimeout(fn, 0)
  }
  const go = (href: string) => then(() => router.push(href))

  const commands: Row[] = [
    {
      key: "new-folder",
      label: "New folder",
      icon: FolderSimplePlusIcon,
      run: then(() => startNewFolder(router)),
    },
    {
      key: "upload",
      label: "Upload files",
      icon: FileArrowUpIcon,
      run: then(() => pick("files")),
    },
    {
      key: "upload-folder",
      label: "Upload a folder",
      icon: UploadSimpleIcon,
      run: then(() => pick("folder")),
    },
    {
      key: "go-files",
      label: "Go to My files",
      icon: FolderIcon,
      run: go("/"),
    },
    {
      key: "go-recent",
      label: "Go to Recent",
      icon: ClockIcon,
      run: go("/recent"),
    },
    {
      key: "go-starred",
      label: "Go to Starred",
      icon: StarIcon,
      run: go("/starred"),
    },
    {
      key: "go-shared",
      label: "Go to Shared files",
      icon: UsersIcon,
      run: go("/shared"),
    },
    {
      key: "go-trash",
      label: "Go to Trash",
      icon: TrashIcon,
      run: go("/trash"),
    },
    {
      key: "go-account",
      label: "Go to Account",
      icon: UserIcon,
      run: go("/account"),
    },
    ...(admin
      ? [
          {
            key: "go-admin",
            label: "Go to Admin",
            icon: ShieldCheckIcon,
            run: go("/admin"),
          },
        ]
      : []),
    ...(hasLayout
      ? [
          {
            key: "layout",
            label: "Switch between list and grid",
            icon: SquaresFourIcon,
            run: then(() =>
              document
                .querySelector<HTMLButtonElement>(
                  '[role=group][aria-label="Layout"] [aria-pressed=false]'
                )
                ?.click()
            ),
          },
        ]
      : []),
    {
      key: "sidebar",
      label: "Collapse or expand the sidebar",
      icon: SidebarSimpleIcon,
      run: then(() => document.getElementById("sidebar-toggle")?.click()),
    },
  ]

  function openHit(h: Hit) {
    remember(query)
    if (h.kind === "folder") return go(`/folders/${h.id}`)()
    setOpen(false)
    setPreviewing(h)
  }

  const hitRow = (h: Hit): Row => {
    const t = fileType(h.kind, h.mime, h.name)
    return {
      key: h.id,
      label: h.name,
      icon: t.icon,
      iconClass: t.color,
      detail: h.snippet ? <Snippet text={h.snippet} /> : h.where,
      run: () => openHit(h),
    }
  }

  // What's listed: matches for the current text once they've arrived.
  const hits = found?.q === query ? found.hits : null
  const groups: { title: string; rows: Row[] }[] = query
    ? [
        {
          title: "Files",
          rows: (hits ?? [])
            .filter((h) => h.byName)
            .slice(0, 6)
            .map(hitRow),
        },
        {
          title: "Inside files",
          rows: (hits ?? [])
            .filter((h) => !h.byName)
            .slice(0, 4)
            .map(hitRow),
        },
        {
          title: "Commands",
          rows: commands
            .filter((c) =>
              String(c.label).toLowerCase().includes(query.toLowerCase())
            )
            .slice(0, 4),
        },
        {
          title: "",
          rows: [
            {
              key: "all",
              label: (
                <>
                  See all results for{" "}
                  <span className="font-medium">“{query}”</span>
                </>
              ),
              icon: ArrowRightIcon,
              run: () => {
                remember(query)
                go(`/search?q=${encodeURIComponent(query)}`)()
              },
            },
          ],
        },
      ]
    : [
        {
          title: "Recent searches",
          rows: recent.map((s) => ({
            key: `r:${s}`,
            label: s,
            icon: ClockCounterClockwiseIcon,
            run: () => {
              setQ(s)
              setActive(0)
            },
          })),
        },
        { title: "Commands", rows: commands },
      ]
  const rows = groups.flatMap((g) => g.rows)
  const at = Math.min(active, rows.length - 1)

  useEffect(() => {
    list.current
      ?.querySelector(`[data-row="${at}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [at])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const step = e.key === "ArrowDown" ? 1 : -1
      setActive((at + step + rows.length) % rows.length)
    } else if (e.key === "Enter" && rows[at]) {
      e.preventDefault()
      rows[at].run()
    }
  }

  let n = 0
  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => (o ? show() : setOpen(false))}
      >
        <Dialog.Trigger
          id="search-trigger"
          aria-label="Search"
          className="flex h-8 items-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:w-8 max-sm:justify-center sm:w-64 sm:border sm:bg-input/30 sm:px-2.5 sm:hover:bg-input/50 [&_svg]:size-4"
        >
          <MagnifyingGlassIcon className="shrink-0" />
          <span className="flex-1 text-left max-sm:sr-only">Search files</span>
          <kbd className="font-sans text-xs max-sm:hidden">Ctrl K</kbd>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup
            initialFocus={() => document.getElementById("search-input")}
            className="fixed top-[min(12vh,6rem)] left-1/2 z-50 flex max-h-[min(34rem,calc(100svh-8rem))] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg transition-[opacity,scale] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <Dialog.Title className="sr-only">Search</Dialog.Title>
            <div className="flex items-center gap-2 border-b px-4">
              <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="search-input"
                role="combobox"
                aria-label="Search"
                aria-expanded
                aria-controls="search-list"
                aria-activedescendant={
                  rows[at] ? `search-row-${at}` : undefined
                }
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Search names and text in files, or type a command"
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query && hits === null && (
                <span className="text-xs text-muted-foreground">
                  Searching…
                </span>
              )}
            </div>
            <ul
              ref={list}
              id="search-list"
              role="listbox"
              aria-label="Results"
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {groups.map(
                (g) =>
                  g.rows.length > 0 && (
                    <Fragment key={g.title || "end"}>
                      {g.title && (
                        <li
                          role="presentation"
                          className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                        >
                          {g.title}
                        </li>
                      )}
                      {g.rows.map((r) => {
                        const i = n++
                        return (
                          <li
                            key={r.key}
                            id={`search-row-${i}`}
                            data-row={i}
                            role="option"
                            aria-selected={i === at}
                            onPointerMove={() => i !== at && setActive(i)}
                            onClick={r.run}
                            className="flex min-h-9 cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-sm select-none aria-selected:bg-accent"
                          >
                            <r.icon
                              className={cn(
                                "size-4 shrink-0",
                                r.iconClass ?? "text-muted-foreground"
                              )}
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{r.label}</span>
                              {r.detail && (
                                <span className="line-clamp-2 text-xs text-muted-foreground">
                                  {r.detail}
                                </span>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </Fragment>
                  )
              )}
              {query && hits?.length === 0 && (
                <li
                  role="presentation"
                  className="px-2 pt-1 pb-2 text-xs text-muted-foreground"
                >
                  No files match. Names, and text inside documents and images,
                  are searched.
                </li>
              )}
            </ul>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Previewer
        shown={previewing && { item: previewing }}
        open={Boolean(previewing)}
        onClose={() => setPreviewing(null)}
      />
    </>
  )
}
