import { ArrowLeftIcon, ArrowRightIcon, FilesIcon, MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { Empty } from "@/components/empty-state"
import { LIST } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-rules"
import type { ItemsPage } from "@/lib/import/jobs"
import { PAGE } from "@/lib/import/rules"
import { cn } from "@/lib/utils"
import { ago, count } from "./format"

const FILTERS = [
  ["", "All"],
  ["imported", "Brought over"],
  ["skipped", "Skipped"],
  ["failed", "Failed"],
] as const
const LABEL = { imported: "Brought over", skipped: "Already there", failed: "Failed" }

// Every file the import has looked at, newest first. Server-rendered: the filter and search are links and a GET form.
export function Items({ jobId, data, status, q, page }: { jobId: string; data: ItemsPage; status: string; q: string; page: number }) {
  const href = (o: { status?: string; q?: string; p?: number }) => {
    const sp = new URLSearchParams({ job: jobId, tab: "items" })
    const st = o.status ?? status
    const qq = o.q ?? q
    if (st) sp.set("status", st)
    if (qq) sp.set("q", qq)
    if (o.p) sp.set("p", String(o.p))
    return `/more/import?${sp}`
  }
  const pages = Math.max(1, Math.ceil(data.total / PAGE))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Filter items" className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
          {FILTERS.map(([v, text]) => (
            <Link key={v} href={href({ status: v, p: 0 })} aria-current={status === v ? "page" : undefined} className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground">
              {text}
            </Link>
          ))}
        </nav>
        <form action="/more/import" className="relative ml-auto w-full sm:w-64">
          <input type="hidden" name="job" value={jobId} />
          <input type="hidden" name="tab" value="items" />
          {status && <input type="hidden" name="status" value={status} />}
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} aria-label="Search items by path" placeholder="Search by path" className="h-8 w-full rounded-lg border border-input bg-input/30 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11" />
        </form>
      </div>
      {data.items.length === 0 ? (
        <Empty icon={FilesIcon} title={q || status ? "No items match" : "Nothing brought over yet"}>
          <p>{q || status ? "Try another filter or search." : "Files appear here as the import goes through them."}</p>
        </Empty>
      ) : (
        <>
          <ul className={LIST}>
            {data.items.map((i) => (
              <li key={i.id} className="grid gap-1 px-3 py-2.5 sm:px-4">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm" title={i.sourcePath}>{i.sourcePath}</span>
                  <Badge variant="outline" className={cn(i.status === "failed" && "text-destructive")}>{LABEL[i.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                  {formatBytes(i.size)} · {i.mtime ? `dated ${ago(i.mtime)} · ` : ""}checked {ago(i.updatedAt)}
                </p>
                {i.error && <p className="text-xs text-pretty text-destructive">{i.error}</p>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums">
            <span>{count(data.total)} item{data.total === 1 ? "" : "s"}</span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                {page > 0 ? <Link href={href({ p: page - 1 })} aria-label="Previous page" className={buttonVariants({ variant: "outline", size: "icon" })}><ArrowLeftIcon /></Link> : null}
                Page {page + 1} of {pages}
                {page + 1 < pages ? <Link href={href({ p: page + 1 })} aria-label="Next page" className={buttonVariants({ variant: "outline", size: "icon" })}><ArrowRightIcon /></Link> : null}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
