"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react"
import { usePathname, useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"

import { findMembers } from "@/app/(app)/admin/actions"
import { ADMIN_GROUPS, ADMIN_SETTINGS } from "@/components/admin-pages"
import { DIALOG_BACKDROP } from "@/components/overlay-styles"
import { SearchPalette } from "@/components/search-palette"

// The header search: files everywhere, admin pages and settings under /admin.
export function Search({ admin }: { admin: boolean }) {
  const path = usePathname()
  return admin && path.startsWith("/admin") ? (
    <AdminSearch />
  ) : (
    <SearchPalette admin={admin} />
  )
}

type Row = {
  key: string
  label: string
  detail?: string
  icon: Icon
  href: string
}
type Member = Awaited<ReturnType<typeof findMembers>>[number]

const PAGES = ADMIN_GROUPS.flatMap((g) =>
  g.pages.map((p) => ({ ...p, group: g.title || "Admin" }))
)
const pageLabel = (href: string) =>
  PAGES.find((p) => p.href === href)?.label ?? "Admin"

const memberHref = (m: Member) =>
  m.status === "pending"
    ? "/admin/approvals"
    : `/admin/members?q=${encodeURIComponent(m.email)}${m.status === "rejected" ? "&status=rejected" : ""}`

function AdminSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const [members, setMembers] = useState<{ q: string; rows: Member[] }>()
  const list = useRef<HTMLUListElement>(null)

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

  const query = q.trim().toLowerCase()
  useEffect(() => {
    if (query.length < 2) return
    let live = true
    const t = setTimeout(
      () =>
        findMembers(query).then(
          (rows) => live && setMembers({ q: query, rows }),
          () => live && setMembers({ q: query, rows: [] })
        ),
      150
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const has = (...text: string[]) =>
    query
      .split(/\s+/)
      .every((w) => text.some((t) => t.toLowerCase().includes(w)))

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Settings",
      rows: query
        ? ADMIN_SETTINGS.filter((s) =>
            has(s.label, s.keywords, pageLabel(s.href))
          )
            .slice(0, 8)
            .map((s) => ({
              key: s.id,
              label: s.label,
              detail: pageLabel(s.href),
              icon: SlidersHorizontalIcon,
              href: `${s.href}#${s.id}`,
            }))
        : [],
    },
    {
      title: "Pages",
      rows: PAGES.filter((p) => !query || has(p.label, p.group)).map((p) => ({
        key: p.href,
        label: p.label,
        detail: p.group,
        icon: p.icon,
        href: p.href,
      })),
    },
    {
      title: "Members",
      rows:
        members?.q === query && query.length >= 2
          ? members.rows.map((m) => ({
              key: m.id,
              label: m.name,
              detail:
                m.status === "active"
                  ? m.email
                  : `${m.email} · ${m.status === "pending" ? "Waiting" : "Declined"}`,
              icon: UserIcon,
              href: memberHref(m),
            }))
          : [],
    },
  ]
  const rows = groups.flatMap((g) => g.rows)
  const at = Math.min(active, rows.length - 1)

  useEffect(() => {
    list.current
      ?.querySelector(`[data-row="${at}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [at])

  function go(href: string) {
    setOpen(false)
    router.push(href)
    // Same-page anchors don't change the path; tell HashFlash.
    setTimeout(
      () => window.dispatchEvent(new HashChangeEvent("hashchange")),
      50
    )
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!rows.length) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const step = e.key === "ArrowDown" ? 1 : -1
      setActive((at + step + rows.length) % rows.length)
    } else if (e.key === "Enter" && rows[at]) {
      e.preventDefault()
      go(rows[at].href)
    }
  }

  let n = 0
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setQ("")
          setActive(0)
        }
      }}
    >
      <Dialog.Trigger
        id="search-trigger"
        aria-label="Search admin"
        className="flex h-8 items-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:w-8 max-sm:justify-center sm:w-64 sm:border sm:bg-input/30 sm:px-2.5 sm:hover:bg-input/50 [&_svg]:size-4"
      >
        <MagnifyingGlassIcon className="shrink-0" />
        <span className="flex-1 text-left max-sm:sr-only">
          Search admin
        </span>
        <kbd className="font-sans text-xs max-sm:hidden">Ctrl K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup
          initialFocus={() => document.getElementById("admin-search-input")}
          className="fixed top-[min(12vh,6rem)] left-1/2 z-50 flex max-h-[min(34rem,calc(100svh-8rem))] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg transition-[opacity,scale] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <Dialog.Title className="sr-only">Search admin</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-4">
            <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              id="admin-search-input"
              role="combobox"
              aria-label="Search admin"
              aria-expanded
              aria-controls="admin-search-list"
              aria-activedescendant={rows[at] ? `admin-row-${at}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Find a setting, page or member"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul
            ref={list}
            id="admin-search-list"
            role="listbox"
            aria-label="Results"
            className="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {groups.map(
              (g) =>
                g.rows.length > 0 && (
                  <Fragment key={g.title}>
                    <li
                      role="presentation"
                      className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {g.title}
                    </li>
                    {g.rows.map((r) => {
                      const i = n++
                      return (
                        <li
                          key={r.key}
                          id={`admin-row-${i}`}
                          data-row={i}
                          role="option"
                          aria-selected={i === at}
                          onPointerMove={() => i !== at && setActive(i)}
                          onClick={() => go(r.href)}
                          className="flex min-h-9 cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-sm select-none aria-selected:bg-accent"
                        >
                          <r.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {r.label}
                          </span>
                          {r.detail && (
                            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                              {r.detail}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </Fragment>
                )
            )}
            {!rows.length && (
              <li
                role="presentation"
                className="px-2 py-6 text-center text-sm text-muted-foreground"
              >
                Nothing matches “{q.trim()}”. Try a word like quota, links or
                2fa.
              </li>
            )}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
