"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FileXIcon,
  FilesIcon,
  GearSixIcon,
  HourglassMediumIcon,
  ListIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  UploadSimpleIcon,
  WarningIcon,
  XIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import type {
  DocSender,
  DocType,
  DocumentItem,
  DocumentsResponse,
  DocumentsSummary,
  DocumentsTotalRow,
} from "@nimbus/shared/documents-api"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import {
  bulkDocs,
  dismissDocs,
  docTotals,
  docUploadTarget,
  listDocs,
  markDocs,
  mergeDocs,
} from "@/app/(app)/documents/actions"
import { SELECT } from "@/components/admin/setting-styles"
import { Expiry, day, money } from "@/components/doc-bits"
import { Previewer } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readDrop, useUploads } from "@/components/upload-provider"
import {
  activeCount,
  DEFAULT,
  hrefOf,
  toQuery,
  type Filters,
  type Tab,
} from "@/lib/doc-filters"
import { fileType } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

// A document as the previewer knows a file.
const asItem = (d: DocumentItem): Item => ({
  id: d.id,
  kind: "file",
  name: d.name,
  size: d.size,
  mime: d.mime,
  starred: false,
  updatedAt: d.updatedAt,
  trashedAt: null,
  tags: [],
  version: d.version,
  thumb: d.thumb,
  sharedWithPeople: false,
  hasLink: false,
  ...(d.role === "viewer" && {
    role: "viewer" as const,
    owner: d.owner ?? undefined,
  }),
})

const TAB_LABEL: Record<Tab, string> = {
  all: "All",
  review: "Needs review",
  totals: "Totals",
  hidden: "Not documents",
}
const COLS =
  "grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_9rem_7rem_7rem_8rem] "

export function DocumentsView({
  filters,
  summary,
  types,
  senders,
  years,
  first,
  totals,
  layout,
  open,
}: {
  filters: Filters
  summary: DocumentsSummary
  types: DocType[]
  senders: DocSender[]
  years: number[]
  first: DocumentsResponse | null
  totals: DocumentsTotalRow[] | null
  layout: "list" | "grid"
  open: DocumentItem | null
}) {
  const router = useRouter()
  const notice = useNotice()
  const { upload, download } = useUploads()
  const [, start] = useTransition()
  const [pending, startFilter] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)
  const [view, setView] = useState(layout)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(activeCount(filters) > 0)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  // The file in the previewer, and whether it opens with the Document panel.
  const [shown, setShown] = useState<string | null>(open?.id ?? null)
  const [shownOpen, setShownOpen] = useState(Boolean(open))
  const [opened, setOpened] = useState<DocumentItem | null>(open)

  // Filters live in the URL; the page reloads its data through the server.
  const go = (next: Partial<Filters>, replace = true) =>
    startFilter(() => {
      const href = hrefOf({ ...filters, ...next })
      if (replace) router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    })

  // Search as you type, after a short pause.
  const [text, setText] = useState(filters.q)
  const [lastQ, setLastQ] = useState(filters.q)
  if (filters.q !== lastQ) {
    setLastQ(filters.q)
    setText(filters.q)
  }
  useEffect(() => {
    if (text === filters.q) return
    const t = setTimeout(() => go({ q: text }), 300)
    return () => clearTimeout(t)
    // go changes every render; only the text should restart the pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  // More pages are fetched here; they belong to the filters they were fetched for.
  const [more, setMore] = useState<{
    base: DocumentsResponse | null
    items: DocumentItem[]
    next: number | null
  } | null>(null)
  // A fresh first page (a refresh after any change) drops them, so offsets never go stale.
  const extra = more?.base === first ? more : null
  const items = first ? [...first.items, ...(extra?.items ?? [])] : []
  const next = extra ? extra.next : (first?.nextCursor ?? null)

  const [loading, setLoading] = useState(false)
  async function loadMore() {
    if (next === null || loading) return
    setLoading(true)
    try {
      const r = await listDocs({ ...toQuery(filters), cursor: next })
      setMore({
        base: first,
        items: [...(extra?.items ?? []), ...r.items],
        next: r.nextCursor,
      })
    } catch {
      notice({ text: "Couldn't load more.", error: true })
    } finally {
      setLoading(false)
    }
  }

  const chosen = items.filter((i) => selected.has(i.id))
  const mine = chosen.length > 0 && chosen.every((i) => i.role === "owner")
  const previewItems =
    open && !items.some((i) => i.id === open.id) ? [open, ...items] : items
  const shownDoc =
    previewItems.find((i) => i.id === shown) ??
    (opened?.id === shown ? opened : null)
  const at = shownDoc ? previewItems.findIndex((i) => i.id === shownDoc.id) : -1

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  const allOn = items.length > 0 && items.every((i) => selected.has(i.id))

  function chooseView(v: "list" | "grid") {
    setView(v)
    document.cookie = `docs_view=${v}; path=/; max-age=31536000; samesite=lax`
  }

  // Runs one change, then reloads the page's data.
  async function change(
    task: () => Promise<{ error?: string }>,
    text: string,
    undo?: () => Promise<unknown>
  ) {
    setBusy(true)
    try {
      const r = await task()
      if (r.error) return notice({ text: r.error, error: true })
      notice({
        text,
        undo: undo && (() => void undo().then(() => router.refresh())),
      })
      setSelected(new Set())
      start(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    const t = await docUploadTarget()
    if ("error" in t && t.error) return notice({ text: t.error, error: true })
    upload(
      files.map((file) => ({ file, path: file.name })),
      t.folderId!,
      () => {
        notice({
          text: `Added to ${t.path}. New documents show up here once they have been read.`,
        })
        router.refresh()
      }
    )
  }

  const sortBy = (sort: Filters["sort"]) =>
    go({
      sort,
      order:
        filters.sort === sort
          ? filters.order === "asc"
            ? "desc"
            : "asc"
          : sort === "name"
            ? "asc"
            : "desc",
    })

  const tabLink = (tab: Tab) => (
    <Link
      key={tab}
      href={hrefOf({ ...DEFAULT, tab })}
      aria-current={tab === filters.tab ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        tab === filters.tab
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-background hover:bg-muted"
      )}
    >
      {TAB_LABEL[tab]}
      {tab === "review" && summary.review > 0 && (
        <span
          className={cn(
            "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums",
            tab === filters.tab
              ? "bg-primary-foreground/20"
              : "bg-warning/20 text-warning"
          )}
        >
          {summary.review}
        </span>
      )}
    </Link>
  )

  const sortHead = (k: Filters["sort"], label: string, className?: string) => {
    const Arrow = filters.order === "asc" ? ArrowUpIcon : ArrowDownIcon
    return (
      <span className={className}>
        <button
          type="button"
          onClick={() => sortBy(k)}
          aria-label={`Sort by ${label.toLowerCase()}`}
          className={cn(
            "-mx-1 inline-flex items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            filters.sort === k && "text-foreground"
          )}
        >
          {label}
          {filters.sort === k && <Arrow className="size-3" />}
        </button>
      </span>
    )
  }

  const typeChip = (d: DocumentItem) =>
    d.typeName ? (
      <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
        {d.typeName}
      </span>
    ) : null
  const flags = (d: DocumentItem) => (
    <>
      {d.status === "review" && (
        <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[11px] font-medium text-warning">
          Needs review
        </span>
      )}
      {d.dupOf && (
        <WarningIcon
          aria-label="Possible duplicate"
          className="size-3.5 shrink-0 text-warning"
        />
      )}
      {d.role === "viewer" && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
          Shared by {d.owner}
        </span>
      )}
    </>
  )

  const check = (d: DocumentItem) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected.has(d.id)}
      aria-label={`Select ${d.name}`}
      onClick={(e) => {
        e.stopPropagation()
        toggle(d.id)
      }}
      className={cn(
        "grid size-5 place-items-center rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected.has(d.id)
          ? "border-brand bg-brand text-background"
          : "border-input bg-input/30 hover:bg-input/60"
      )}
    >
      {selected.has(d.id) && (
        <CheckCircleIcon weight="fill" className="size-4" />
      )}
    </button>
  )

  const row = (d: DocumentItem) => {
    const t = fileType("file", d.mime, d.name)
    return (
      <div
        key={d.id}
        id={`doc-${d.id}`}
        role="option"
        aria-selected={selected.has(d.id)}
        tabIndex={0}
        onClick={() => {
          setShown(d.id)
          setShownOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            setShown(d.id)
            setShownOpen(true)
          } else if (e.key === " " && e.target === e.currentTarget) {
            e.preventDefault()
            toggle(d.id)
          }
        }}
        className={cn(
          "group grid min-h-14 cursor-default items-center gap-3 py-2 pr-3 pl-3 transition-colors outline-none select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset aria-selected:bg-brand/8",
          COLS
        )}
      >
        {check(d)}
        <span className="flex min-w-0 items-center gap-3">
          <t.icon weight="light" className={cn("size-6 shrink-0", t.color)} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium" title={d.name}>
                {d.name}
              </span>
              <span className="flex items-center gap-1.5 max-sm:hidden">
                {typeChip(d)}
                {flags(d)}
              </span>
              {d.status === "review" && (
                <span
                  role="img"
                  aria-label="Needs review"
                  className="size-2 shrink-0 rounded-full bg-warning sm:hidden"
                />
              )}
              {d.dupOf && (
                <WarningIcon
                  aria-label="Possible duplicate"
                  className="size-3.5 shrink-0 text-warning sm:hidden"
                />
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums sm:hidden">
              {[
                d.typeName,
                d.senderName,
                day(d.docDate),
                money(d.amount, d.currency),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </span>
        <span
          className="truncate text-sm text-muted-foreground max-sm:hidden"
          title={d.senderName ?? undefined}
        >
          {d.senderName ?? "·"}
        </span>
        <span
          suppressHydrationWarning
          className="truncate text-sm text-muted-foreground tabular-nums max-sm:hidden"
        >
          {day(d.docDate) || "·"}
        </span>
        <span className="truncate text-right text-sm tabular-nums max-sm:hidden">
          {money(d.amount, d.currency) || (
            <span className="text-muted-foreground">·</span>
          )}
        </span>
        <span className="max-sm:hidden" suppressHydrationWarning>
          <Expiry
            date={d.expiresAt}
            daysLeft={d.daysLeft}
            remindDays={d.remindDays}
          />
        </span>
      </div>
    )
  }

  const card = (d: DocumentItem) => {
    const t = fileType("file", d.mime, d.name)
    return (
      <div
        key={d.id}
        id={`doc-${d.id}`}
        role="option"
        aria-selected={selected.has(d.id)}
        tabIndex={0}
        onClick={() => {
          setShown(d.id)
          setShownOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            setShown(d.id)
            setShownOpen(true)
          } else if (e.key === " " && e.target === e.currentTarget) {
            e.preventDefault()
            toggle(d.id)
          }
        }}
        className="group relative flex cursor-default flex-col rounded-xl border transition-colors outline-none select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:border-brand/60 aria-selected:bg-brand/8"
      >
        <Thumb
          item={asItem(d)}
          make={d.role === "owner"}
          className="m-1.5 grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted/40"
        >
          <t.icon
            weight="light"
            className={cn("size-12 opacity-80", t.color)}
          />
        </Thumb>
        <div className="absolute top-3 left-3">{check(d)}</div>
        <div className="flex min-w-0 flex-col gap-1 px-3 pb-3">
          <span className="truncate text-sm font-medium" title={d.name}>
            {d.name}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {typeChip(d)}
            {flags(d)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {d.senderName ?? "No sender"}
          </span>
          <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <span suppressHydrationWarning>{day(d.docDate) || "No date"}</span>
            <span className="text-sm text-foreground">
              {money(d.amount, d.currency)}
            </span>
          </span>
          {d.expiresAt && (
            <span suppressHydrationWarning>
              <Expiry
                date={d.expiresAt}
                daysLeft={d.daysLeft}
                remindDays={d.remindDays}
              />
            </span>
          )}
        </div>
      </div>
    )
  }

  const soon = summary.expiring
  const strip = filters.tab === "all" && (
    <section
      aria-label="Summary"
      className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <HourglassMediumIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Expiring soon</h2>
          {soon.length > 0 && (
            <Link
              href={hrefOf({ ...DEFAULT, expiring: "soon" })}
              className="ml-auto rounded text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Show all
            </Link>
          )}
        </div>
        {soon.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is due or about to expire.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {soon.slice(0, 4).map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setShown(d.id)
                    setShownOpen(true)
                    setOpened(d)
                  }}
                  className="flex h-9 w-full items-center gap-3 rounded-md text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {d.name}
                  </span>
                  <span suppressHydrationWarning className="shrink-0">
                    <ExpiryText daysLeft={d.daysLeft} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col justify-between gap-2 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Needs review</h2>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {summary.review}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={summary.review === 0}
            render={<Link href={hrefOf({ ...DEFAULT, tab: "review" })} />}
            nativeButton={false}
          >
            Review now
          </Button>
        </div>
      </div>
    </section>
  )

  const f = filters
  const field = (label: string, control: React.ReactNode) => (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {control}
    </label>
  )
  const panel = filtersOpen && (
    <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      {field(
        "Type",
        <select
          value={f.type}
          onChange={(e) => go({ type: e.target.value })}
          className={SELECT}
        >
          <option value="">Any type</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {field(
        "Sender",
        <select
          value={f.sender}
          onChange={(e) => go({ sender: e.target.value })}
          className={SELECT}
        >
          <option value="">Any sender</option>
          {senders.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {field(
        "Year",
        <select
          value={f.year}
          onChange={(e) => go({ year: e.target.value, from: "", to: "" })}
          className={SELECT}
        >
          <option value="">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      {field(
        "Expiry",
        <select
          value={f.expiring}
          onChange={(e) =>
            go({ expiring: e.target.value as Filters["expiring"] })
          }
          className={SELECT}
        >
          <option value="">Any</option>
          <option value="soon">Expiring soon</option>
          <option value="expired">Expired</option>
          <option value="any">Has an expiry date</option>
        </select>
      )}
      {field(
        "From",
        <Input
          type="date"
          value={f.from}
          max={f.to || undefined}
          onChange={(e) => go({ from: e.target.value, year: "" })}
        />
      )}
      {field(
        "To",
        <Input
          type="date"
          value={f.to}
          min={f.from || undefined}
          onChange={(e) => go({ to: e.target.value, year: "" })}
        />
      )}
      {field(
        "Amount from",
        <Input
          type="number"
          inputMode="decimal"
          value={f.min}
          onChange={(e) => go({ min: e.target.value })}
          className="tabular-nums"
        />
      )}
      {field(
        "Amount up to",
        <Input
          type="number"
          inputMode="decimal"
          value={f.max}
          onChange={(e) => go({ max: e.target.value })}
          className="tabular-nums"
        />
      )}
      {field(
        "Missing a field",
        <select
          value={f.missing}
          onChange={(e) => go({ missing: e.target.value })}
          className={SELECT}
        >
          <option value="">Nothing missing</option>
          <option value="type">No type</option>
          <option value="sender">No sender</option>
          <option value="date">No date</option>
          <option value="amount">No amount</option>
          <option value="expiry">No expiry</option>
        </select>
      )}
    </div>
  )

  const filtering = activeCount(filters) > 0 || Boolean(filters.q)
  const empty = (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted">
        {filtering ? (
          <MagnifyingGlassIcon className="size-6 text-muted-foreground" />
        ) : (
          <FilesIcon className="size-6 text-muted-foreground" />
        )}
      </span>
      <div className="max-w-sm">
        <p className="font-medium">
          {filtering
            ? "No documents match"
            : filters.tab === "review"
              ? "Nothing to review"
              : filters.tab === "hidden"
                ? "No hidden files"
                : "No documents yet"}
        </p>
        <p className="mt-1 text-sm text-balance text-muted-foreground">
          {filtering
            ? "Try fewer filters or a different word."
            : filters.tab === "review"
              ? "Every document has been checked."
              : filters.tab === "hidden"
                ? "Files you mark “Not a document” are listed here, so you can bring them back."
                : "PDFs and scans are picked up as documents automatically, wherever they are. Uploads here go into a Documents folder, filed by year."}
        </p>
      </div>
      {filtering ? (
        <Button
          variant="outline"
          onClick={() =>
            router.replace(hrefOf({ ...DEFAULT, tab: filters.tab }))
          }
        >
          Clear filters
        </Button>
      ) : (
        filters.tab === "all" && (
          <Button onClick={() => fileInput.current?.click()}>
            <UploadSimpleIcon />
            Upload documents
          </Button>
        )
      )}
    </div>
  )

  const total = first?.total ?? 0
  const sub =
    filters.tab === "totals"
      ? "What your documents add up to"
      : `${total.toLocaleString()} ${total === 1 ? "document" : "documents"}${filtering ? " match" : ""}`

  return (
    <div
      className="relative flex min-h-[calc(100svh-10rem)] flex-col gap-4"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDrag(false)
        void readDrop(e.dataTransfer).then((x) =>
          uploadFiles(
            x.flatMap((i) => (i.file instanceof File ? [i.file] : []))
          )
        )
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{sub}</p>
        </div>
        <div className="flex items-center gap-1">
          {filters.tab !== "totals" && (
            <div role="group" aria-label="Layout" className="flex">
              <Button
                variant="ghost"
                size="icon"
                aria-label="List"
                aria-pressed={view === "list"}
                className={cn(view === "list" && "bg-accent")}
                onClick={() => chooseView("list")}
              >
                <ListIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Grid"
                aria-pressed={view === "grid"}
                className={cn(view === "grid" && "bg-accent")}
                onClick={() => chooseView("grid")}
              >
                <SquaresFourIcon />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Document settings"
            title="Types, senders and watched folders"
            render={<Link href="/documents/settings" />}
            nativeButton={false}
          >
            <GearSixIcon />
          </Button>
          <Button onClick={() => fileInput.current?.click()}>
            <UploadSimpleIcon />
            Upload
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="documents-upload"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ""
              void uploadFiles(files)
            }}
          />
        </div>
      </div>

      <nav
        aria-label="Documents"
        className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {(["all", "review", "totals", "hidden"] as Tab[]).map(tabLink)}
      </nav>

      {strip}

      {filters.tab === "totals" ? (
        <Totals initial={totals ?? []} years={years} year={filters.year} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-sm">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search documents"
                placeholder="Search documents"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant={filtersOpen ? "secondary" : "outline"}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontalIcon />
              Filters
              {activeCount(filters) > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
                  {activeCount(filters)}
                </span>
              )}
            </Button>
            {filtering && (
              <Button
                variant="ghost"
                onClick={() =>
                  router.replace(hrefOf({ ...DEFAULT, tab: filters.tab }))
                }
              >
                <XIcon />
                Clear
              </Button>
            )}
          </div>
          {panel}

          <div
            aria-busy={pending}
            className={cn(
              "flex flex-1 flex-col gap-4 transition-opacity",
              pending && "opacity-60"
            )}
          >
            {items.length === 0 ? (
              empty
            ) : view === "list" ? (
              <div className="overflow-hidden rounded-xl border bg-card">
                <div
                  className={cn(
                    "grid h-9 items-center gap-3 border-b pr-3 pl-3 text-xs font-medium text-muted-foreground",
                    COLS
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={allOn}
                    aria-label="Select all"
                    onClick={() =>
                      setSelected(
                        allOn ? new Set() : new Set(items.map((i) => i.id))
                      )
                    }
                    className={cn(
                      "grid size-5 place-items-center rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      allOn
                        ? "border-brand bg-brand text-background"
                        : "border-input bg-input/30 hover:bg-input/60"
                    )}
                  >
                    {allOn && (
                      <CheckCircleIcon weight="fill" className="size-4" />
                    )}
                  </button>
                  {sortHead("name", "Name")}
                  <span className="max-sm:hidden">Sender</span>
                  {sortHead("date", "Date", "max-sm:hidden")}
                  {sortHead("amount", "Amount", "text-right max-sm:hidden")}
                  {sortHead("expires", "Expires", "max-sm:hidden")}
                </div>
                <div
                  role="listbox"
                  aria-label="Documents"
                  aria-multiselectable
                  className="divide-y"
                >
                  {items.map(row)}
                </div>
              </div>
            ) : (
              <div
                role="listbox"
                aria-label="Documents"
                aria-multiselectable
                className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]"
              >
                {items.map(card)}
              </div>
            )}
            {next !== null && (
              <Button
                variant="outline"
                className="self-center"
                disabled={loading}
                onClick={() => void loadMore()}
              >
                Show more
              </Button>
            )}
          </div>
        </>
      )}

      {chosen.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selected documents"
          className="sticky bottom-4 z-20 mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border bg-popover p-2 pl-4 text-popover-foreground shadow-lg"
        >
          <span className="text-sm tabular-nums" aria-live="polite">
            {chosen.length} selected
          </span>
          {mine && filters.tab !== "hidden" && (
            <>
              <select
                aria-label="Set type"
                value=""
                disabled={busy}
                onChange={(e) => {
                  const typeId = e.target.value
                  if (typeId)
                    void change(
                      () => bulkDocs({ ids: chosen.map((i) => i.id), typeId }),
                      `Type set on ${chosen.length}.`
                    )
                }}
                className={cn(SELECT, "h-8 w-36")}
              >
                <option value="">Set type…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Set sender"
                value=""
                disabled={busy || senders.length === 0}
                onChange={(e) => {
                  const senderId = e.target.value
                  if (senderId)
                    void change(
                      () =>
                        bulkDocs({ ids: chosen.map((i) => i.id), senderId }),
                      `Sender set on ${chosen.length}.`
                    )
                }}
                className={cn(SELECT, "h-8 w-36")}
              >
                <option value="">Set sender…</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {chosen.some((i) => i.status === "review") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      () =>
                        bulkDocs({
                          ids: chosen.map((i) => i.id),
                          confirm: true,
                        }),
                      `Confirmed ${chosen.length}.`
                    )
                  }
                >
                  <CheckCircleIcon />
                  Confirm
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void change(async () => {
                    notice({ text: "Merging…" })
                    const r = await mergeDocs(chosen.map((i) => i.id))
                    return r
                  }, "Merged into one PDF in your Documents folder.")
                }
              >
                <FilesIcon />
                Merge into PDF
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              download(
                chosen.map((i) => ({
                  id: i.id,
                  kind: "file" as const,
                  name: i.name,
                }))
              )
            }
          >
            <DownloadSimpleIcon />
            Download
          </Button>
          {mine &&
            (filters.tab === "hidden" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void change(
                    () => markDocs(chosen.map((i) => i.id)),
                    "Back in Documents."
                  )
                }
              >
                <FileTextIcon />
                Mark as document
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const ids = chosen.map((i) => i.id)
                  void change(
                    () => dismissDocs(ids),
                    `${ids.length === 1 ? "1 file" : `${ids.length} files`} hidden from Documents.`,
                    () => markDocs(ids)
                  )
                }}
              >
                <FileXIcon />
                Not a document
              </Button>
            ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Cancel
          </Button>
        </div>
      )}

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-background/80 text-lg font-medium">
          Drop to add to Documents
        </div>
      )}

      <Previewer
        shown={shownDoc && { item: asItem(shownDoc) }}
        open={shownOpen && Boolean(shownDoc)}
        onClose={() => {
          setShownOpen(false)
          // The panel may have changed fields.
          router.refresh()
        }}
        docFirst
        editable={shownDoc?.role === "owner"}
        queue={previewItems.map(asItem)}
        onPrev={at > 0 ? () => setShown(previewItems[at - 1].id) : undefined}
        onNext={
          at >= 0 && at < previewItems.length - 1
            ? () => setShown(previewItems[at + 1].id)
            : undefined
        }
        position={
          at >= 0 && previewItems.length > 1
            ? `${at + 1} of ${previewItems.length}`
            : undefined
        }
      />
    </div>
  )
}

function ExpiryText({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return null
  const past = daysLeft < 0
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        past ? "text-destructive" : "text-warning"
      )}
    >
      {past
        ? `Expired ${-daysLeft}d ago`
        : daysLeft === 0
          ? "Today"
          : `In ${daysLeft}d`}
    </span>
  )
}

const monthName = (p: string) =>
  p.length === 7
    ? new Date(`${p}-15T12:00:00`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : p

// What documents add up to, per month or year, by sender or type, in each currency.
function Totals({
  initial,
  years,
  year,
}: {
  initial: DocumentsTotalRow[]
  years: number[]
  year: string
}) {
  const [by, setBy] = useState<"sender" | "type">("sender")
  const [period, setPeriod] = useState<"month" | "year">("month")
  const [yr, setYr] = useState(year)
  const key = `${by}:${period}:${yr}`
  const [res, setRes] = useState<{ key: string; rows: DocumentsTotalRow[] }>({
    key: `sender:month:${year}`,
    rows: initial,
  })
  useEffect(() => {
    if (res.key === key) return
    let live = true
    void docTotals({ by, period, ...(yr && { year: Number(yr) }) }).then(
      (r) => live && setRes({ key, rows: r.rows })
    )
    return () => {
      live = false
    }
  }, [key, res.key, by, period, yr])
  const rows = res.key === key ? res.rows : null

  const groups = new Map<string, DocumentsTotalRow[]>()
  for (const r of rows ?? [])
    groups.set(r.period, [...(groups.get(r.period) ?? []), r])

  const seg = <T extends string>(
    value: T,
    set: (v: T) => void,
    opts: [T, string][],
    label: string
  ) => (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg border bg-input/30 p-0.5"
    >
      {opts.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => set(v)}
          className={cn(
            "h-8 rounded-md px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === v
              ? "bg-accent font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )

  return (
    <section aria-label="Totals" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {seg(
          by,
          setBy,
          [
            ["sender", "By sender"],
            ["type", "By type"],
          ],
          "Group by"
        )}
        {seg(
          period,
          setPeriod,
          [
            ["month", "Per month"],
            ["year", "Per year"],
          ],
          "Period"
        )}
        <select
          aria-label="Year"
          value={yr}
          onChange={(e) => setYr(e.target.value)}
          className={cn(SELECT, "h-9 w-32")}
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Adding up…</p>
      ) : groups.size === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <p className="font-medium">Nothing to add up yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Totals use documents that have both an amount and a date.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[...groups].map(([p, list]) => {
            const sums = new Map<string, number>()
            for (const r of list)
              sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.total)
            return (
              <div
                key={p}
                className="overflow-hidden rounded-xl border bg-card"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">{monthName(p)}</h3>
                  <span className="ml-auto flex flex-wrap gap-x-3 text-sm font-medium tabular-nums">
                    {[...sums].map(([c, t]) => (
                      <span key={c}>{money(t, c || null)}</span>
                    ))}
                  </span>
                </div>
                <ul className="divide-y">
                  {list.map((r) => {
                    const max = Math.max(
                      ...list
                        .filter((x) => x.currency === r.currency)
                        .map((x) => x.total)
                    )
                    return (
                      <li
                        key={`${r.key}:${r.currency}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                      >
                        <span className="truncate">{r.label}</span>
                        <span className="text-right tabular-nums">
                          {money(r.total, r.currency || null)}
                        </span>
                        <span className="h-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-brand/60"
                            style={{
                              width: `${max > 0 ? Math.max(2, (r.total / max) * 100) : 0}%`,
                            }}
                          />
                        </span>
                        <span className="text-right text-xs text-muted-foreground tabular-nums">
                          {r.count} {r.count === 1 ? "document" : "documents"}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
