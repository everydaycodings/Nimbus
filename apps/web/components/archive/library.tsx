"use client"

import { CircleNotchIcon, GlobeIcon, ListIcon, MagnifyingGlassIcon, SquaresFourIcon, WarningCircleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { Empty, SELECT } from "@/components/registry-ui"
import { Input } from "@/components/ui/input"
import type { PageView } from "@/lib/archive/run"
import { cn } from "@/lib/utils"
import { FILE, scheduleText } from "./format"

const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

function Thumb({ id, className }: { id: string | null; className?: string }) {
  // The small copy the server makes after a while; until then the screenshot itself.
  const [src, setSrc] = useState(id ? `/api/files/${id}/thumb` : null)
  const [broken, setBroken] = useState(false)
  if (!id || !src || broken)
    return (
      <span aria-hidden className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <GlobeIcon className="size-6" />
      </span>
    )
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => (src.includes("/thumb") ? setSrc(FILE(id)) : setBroken(true))}
      className={cn("bg-muted object-cover object-top", className)}
    />
  )
}

export function Status({ page: p }: { page: PageView }) {
  if (p.status === "running")
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CircleNotchIcon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Capturing…
      </span>
    )
  if (p.status === "failed")
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-foreground" title={p.error ?? undefined}>
        <WarningCircleIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
        <span className="truncate">Failed{p.error ? `: ${p.error}` : ""}</span>
      </span>
    )
  return null
}

const when = (iso: string | null) => (iso ? <time dateTime={iso} suppressHydrationWarning>{WHEN.format(new Date(iso))}</time> : null)

export function Library({ pages }: { pages: PageView[] }) {
  const [view, setView] = useState<"grid" | "list">("grid")
  const [q, setQ] = useState("")
  const [site, setSite] = useState("")
  const [tag, setTag] = useState("")
  const sites = useMemo(() => [...new Set(pages.map((p) => p.site))].sort(), [pages])
  const tags = useMemo(() => [...new Set(pages.flatMap((p) => p.tags))].sort(), [pages])
  const shown = pages.filter((p) => {
    const n = q.trim().toLowerCase()
    return (!site || p.site === site) && (!tag || p.tags.includes(tag)) && (!n || `${p.title} ${p.url} ${p.tags.join(" ")}`.toLowerCase().includes(n))
  })

  return (
    <section aria-labelledby="archive-library" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="archive-library" className="mr-auto text-base font-semibold">
          Library <span className="font-normal text-muted-foreground tabular-nums">{shown.length === pages.length ? pages.length : `${shown.length} of ${pages.length}`}</span>
        </h2>
        <div className="relative w-full sm:w-56">
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search saved pages" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 pointer-coarse:h-11" />
        </div>
        <select aria-label="Filter by site" value={site} onChange={(e) => setSite(e.target.value)} className={cn(SELECT, "max-w-40 pointer-coarse:h-11")}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s}>{s}</option>)}
        </select>
        {tags.length > 0 && (
          <select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)} className={cn(SELECT, "max-w-40 pointer-coarse:h-11")}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
        <div role="group" aria-label="Layout" className="flex rounded-lg bg-muted p-[3px]">
          {([["grid", SquaresFourIcon, "Grid"], ["list", ListIcon, "List"]] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              aria-label={label}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="flex h-7 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:w-11 aria-pressed:border-input aria-pressed:bg-input/30 aria-pressed:text-foreground"
            >
              <Icon aria-hidden className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty icon={MagnifyingGlassIcon} title="Nothing matches">
          <p>No saved page fits that search and those filters.</p>
        </Empty>
      ) : view === "grid" ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id}>
              <Link href={`/more/archive/${p.id}`} className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Thumb id={p.thumbId} className="aspect-[16/10] w-full border-b" />
                <span className="grid gap-1.5 p-3">
                  <span className="line-clamp-2 text-sm font-medium text-balance" title={p.title || p.url}>{p.title || p.url}</span>
                  <span className="truncate text-sm text-muted-foreground">{p.site}</span>
                  {p.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t}</span>
                      ))}
                      {p.tags.length > 4 && <span className="py-0.5 text-xs text-muted-foreground">+{p.tags.length - 4}</span>}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <Status page={p} />
                    {p.status !== "running" && (p.lastCapturedAt ? <span>Saved {when(p.lastCapturedAt)}</span> : p.status !== "failed" && <span>Not captured yet</span>)}
                    {p.snapshots > 1 && <span>{p.snapshots} versions</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {shown.map((p) => (
            <li key={p.id}>
              <Link href={`/more/archive/${p.id}`} className="flex items-center gap-3 p-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
                <Thumb id={p.thumbId} className="h-12 w-20 shrink-0 rounded-md" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium" title={p.title || p.url}>{p.title || p.url}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {p.site}
                    {p.tags.length > 0 && ` · ${p.tags.join(", ")}`}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                    <Status page={p} />
                    {p.status !== "running" && p.status !== "failed" && (p.lastCapturedAt ? <span>Saved {when(p.lastCapturedAt)}</span> : <span>Not captured yet</span>)}
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">
                  {p.snapshots} {p.snapshots === 1 ? "version" : "versions"} · {scheduleText(p.intervalMin)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
