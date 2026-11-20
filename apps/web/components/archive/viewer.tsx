"use client"

import { ArrowLeftIcon, ArrowSquareOutIcon, CircleNotchIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Empty } from "@/components/registry-ui"
import { buttonVariants } from "@/components/ui/button"
import type { PageView, SnapshotView } from "@/lib/archive/run"
import { formatBytes } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import { Controls } from "./controls"
import { FILE, TABS, type ViewTab } from "./format"
import { Status } from "./library"

const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const BASE = "/more/archive"

const idOf = (s: SnapshotView, tab: ViewTab) => ({ html: s.htmlId, pdf: s.pdfId, png: s.pngId, text: s.textId })[tab]

export function Viewer({ page, snapshots, snapshot, view, cookies }: { page: PageView; snapshots: SnapshotView[]; snapshot: SnapshotView | null; view: ViewTab; cookies: string[] }) {
  const router = useRouter()
  // A capture in progress: look again until it lands.
  useEffect(() => {
    if (page.status !== "running") return
    const t = setInterval(() => router.refresh(), 2500)
    return () => clearInterval(t)
  }, [page.status, router])

  const href = (s: SnapshotView | null, tab: ViewTab) => `${BASE}/${page.id}?${new URLSearchParams({ ...(s ? { s: s.id } : {}), ...(tab === "html" ? {} : { tab }) })}`
  const fileId = snapshot ? idOf(snapshot, view) : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link href={BASE} className="flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11 pointer-coarse:items-center">
        <ArrowLeftIcon aria-hidden className="size-4" />
        Website archive
      </Link>

      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">{page.title || page.url}</h1>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <a href={page.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="truncate">{page.url}</span>
            <ArrowSquareOutIcon aria-hidden className="size-3.5 shrink-0" />
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Status page={page} />
          {page.status === "unchanged" && <span>Checked, no change</span>}
          {page.tags.map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Saved copy" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <nav role="tablist" aria-label="Format" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
              {TABS.map(([t, text]) => (
                <Link
                  key={t}
                  href={href(snapshot, t)}
                  role="tab"
                  aria-selected={view === t}
                  aria-current={view === t ? "page" : undefined}
                  className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
                >
                  {text}
                </Link>
              ))}
            </nav>
            {fileId && (
              <span className="ml-auto flex items-center gap-1">
                <a href={FILE(fileId)} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-coarse:h-11")}>
                  <ArrowSquareOutIcon /> Open
                </a>
                <a href={`/api/files/${fileId}/download`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-coarse:h-11")}>
                  <DownloadSimpleIcon /> Download
                </a>
              </span>
            )}
          </div>

          {!snapshot ? (
            page.status === "running" ? (
              <Empty icon={CircleNotchIcon} title="Capturing this page">
                <p>This takes under a minute for most pages. It appears here when it is done.</p>
              </Empty>
            ) : (
              <Empty icon={WarningCircleIcon} title={page.status === "failed" ? "The last capture failed" : "Not captured yet"}>
                <p>{page.error ?? "Capture it to save a copy."}</p>
              </Empty>
            )
          ) : !fileId ? (
            <Empty icon={WarningCircleIcon} title="That file was deleted">
              <p>The {TABS.find(([t]) => t === view)?.[1].toLowerCase()} copy of this version is no longer in Files. Other formats may still be there.</p>
            </Empty>
          ) : view === "png" ? (
            <div className="max-h-[75vh] overflow-auto rounded-xl border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={FILE(fileId)} alt={`Screenshot of ${page.title || page.url}`} className="w-full" />
            </div>
          ) : view === "pdf" ? (
            <iframe key={fileId} src={FILE(fileId)} title="PDF copy" className="h-[75vh] w-full rounded-xl border bg-white" />
          ) : (
            // No scripts and no same-origin: the saved page can't run code or reach Nimbus, whatever it contains.
            <iframe key={fileId} src={FILE(fileId)} sandbox="" title={view === "html" ? "Saved page" : "Page text"} className="h-[75vh] w-full rounded-xl border bg-white" />
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-6">
          <Controls page={page} cookies={cookies} />
          <section aria-labelledby="archive-versions" className="flex flex-col gap-2">
            <h2 id="archive-versions" className="text-base font-semibold">Versions</h2>
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ol className="divide-y overflow-hidden rounded-xl border bg-card">
                {snapshots.map((s, i) => (
                  <li key={s.id}>
                    <Link
                      href={href(s, view)}
                      aria-current={snapshot?.id === s.id ? "true" : undefined}
                      className="grid gap-0.5 px-3 py-2.5 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 aria-[current=true]:bg-input/30"
                    >
                      <span className="flex items-center gap-2 font-medium tabular-nums">
                        <time dateTime={s.capturedAt} suppressHydrationWarning>{WHEN.format(new Date(s.capturedAt))}</time>
                        {i === 0 && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Latest</span>}
                      </span>
                      <span className="truncate text-muted-foreground">{s.title || page.site} · {formatBytes(s.bytes)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
