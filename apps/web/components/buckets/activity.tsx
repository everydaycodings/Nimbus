"use client"

import { ListChecksIcon } from "@phosphor-icons/react"
import { useId, useRef, useState, useTransition } from "react"

import { moreActivity } from "@/app/(app)/buckets/actions"
import { Unavailable } from "@/components/buckets/chart"
import { TABLE, TD, TH } from "@/components/buckets/table-styles"
import { Empty, SELECT, TOUCH, WHEN } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-types"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import type { ActivityFilter, ActivityRow } from "@/lib/s3api/stats"
import { cn } from "@/lib/utils"

// The S3 operation (as stored) and how the page says it.
const OPS: Record<string, string> = {
  PUT: "Upload",
  MULTIPART_COMPLETE: "Upload (multipart)",
  COPY: "Copy",
  DELETE: "Delete",
  DELETE_MANY: "Delete many",
  GET: "Download",
  HEAD: "Check",
  LIST: "List",
}
const opLabel = (op: string) => OPS[op] ?? op
const FIELD = "pointer-coarse:h-11"

const COL = "hidden md:table-cell"

const Status = ({ n }: { n: number }) => (
  <Badge variant="outline" className={cn(n >= 400 && "border-destructive/60 text-destructive")}>
    {n}
  </Badge>
)

// On phones each row is one summary cell; from md up, a column each.
export function ActivityTable({ rows, hideBucket }: { rows: ActivityRow[]; hideBucket?: boolean }) {
  return (
    <div className={cn(TABLE.wrap, "md:overflow-x-auto")}>
      <table className={cn(TABLE.table, "table-auto tabular-nums md:min-w-[52rem]")}>
        <caption className="sr-only">Recent writes and failed requests, newest first</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Time</th>
            {!hideBucket && <th scope="col" className={cn(TH, COL)}>Bucket</th>}
            <th scope="col" className={cn(TH, COL)}>Key</th>
            <th scope="col" className={cn(TH, COL)}>Operation</th>
            <th scope="col" className={cn(TH, COL)}>Object</th>
            <th scope="col" className={cn(TH, COL)}>Status</th>
            <th scope="col" className={cn(TH, COL, "text-right")}>Size</th>
            <th scope="col" className={cn(TH, COL)}>IP</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={cn(TD, "md:whitespace-nowrap")}>
                <time dateTime={r.at} suppressHydrationWarning>
                  {WHEN.format(new Date(r.at))}
                </time>
                <div className="mt-1.5 grid gap-1 text-xs md:hidden">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{opLabel(r.op)}</span>
                    <Status n={r.status} />
                    {r.bytes > 0 && <span className="text-muted-foreground">{formatBytes(r.bytes)}</span>}
                  </span>
                  {r.objectKey && <span className="font-mono break-all">{r.objectKey}</span>}
                  <span className="text-muted-foreground">
                    {[!hideBucket && r.bucket, r.keyName ?? "Unknown key", r.ip].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </td>
              {!hideBucket && <td className={cn(TD, COL, "font-mono text-xs break-all")}>{r.bucket}</td>}
              <td className={cn(TD, COL, "break-words")}>{r.keyName ?? <span className="text-muted-foreground">Unknown</span>}</td>
              <td className={cn(TD, COL, "whitespace-nowrap")} title={r.op}>
                {opLabel(r.op)}
              </td>
              <td className={cn(TD, COL, "max-w-56 font-mono text-xs break-all")}>{r.objectKey ?? <span className="text-muted-foreground">–</span>}</td>
              <td className={cn(TD, COL)}>
                <Status n={r.status} />
              </td>
              <td className={cn(TD, COL, "text-right whitespace-nowrap")}>{r.bytes ? formatBytes(r.bytes) : "–"}</td>
              <td className={cn(TD, COL, "font-mono text-xs")}>{r.ip ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The Activity tab: the first page comes from the server, filters and "Load more" go through an action.
export function ActivityView({
  initial,
  filter: initialFilter,
  keys,
  buckets,
}: {
  initial: { rows: ActivityRow[]; next: string | null } | null
  filter: ActivityFilter
  keys: KeyRow[]
  buckets: BucketRow[]
}) {
  const id = useId()
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter)
  const [page, setPage] = useState(initial)
  const [failed, setFailed] = useState(initial === null)
  const [pending, start] = useTransition()
  // Answers can arrive out of order when filters change quickly; only the latest counts.
  const latest = useRef(0)

  const load = (f: ActivityFilter, cursor?: string) => {
    const n = ++latest.current
    start(async () => {
      const r = await moreActivity(f, cursor)
      if (n !== latest.current) return
      if (!r) return setFailed(true)
      setFailed(false)
      setPage(cursor && page ? { rows: [...page.rows, ...r.rows], next: r.next } : r)
    })
  }
  const change = (patch: ActivityFilter) => {
    const f = { ...filter, ...patch }
    setFilter(f)
    load(f)
  }
  const filtered = !!(filter.keyId || filter.bucketId || filter.op || filter.errorsOnly)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grid gap-1">
          <label htmlFor={`${id}-bucket`} className="text-xs text-muted-foreground">Bucket</label>
          <select id={`${id}-bucket`} className={cn(SELECT, FIELD)} value={filter.bucketId ?? ""} onChange={(e) => change({ bucketId: e.target.value || undefined })}>
            <option value="">All buckets</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-key`} className="text-xs text-muted-foreground">Access key</label>
          <select id={`${id}-key`} className={cn(SELECT, FIELD)} value={filter.keyId ?? ""} onChange={(e) => change({ keyId: e.target.value || undefined })}>
            <option value="">All keys</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-op`} className="text-xs text-muted-foreground">Operation</label>
          <select id={`${id}-op`} className={cn(SELECT, FIELD)} value={filter.op ?? ""} onChange={(e) => change({ op: e.target.value || undefined })}>
            <option value="">All operations</option>
            {Object.entries(OPS).map(([o, label]) => (
              <option key={o} value={o}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
          <input type="checkbox" className="size-4 accent-primary" checked={!!filter.errorsOnly} onChange={(e) => change({ errorsOnly: e.target.checked || undefined })} />
          Errors only
        </label>
      </div>
      <div aria-live="polite" aria-busy={pending} className={cn("grid gap-3 transition-opacity motion-reduce:transition-none", pending && "opacity-60")}>
        {failed ? (
          <Unavailable what="activity" />
        ) : !page || page.rows.length === 0 ? (
          <Empty icon={ListChecksIcon} title={filtered ? "Nothing matches" : "No activity yet"}>
            {filtered
              ? "Try another bucket, key or operation, or turn off the filters."
              : "We log writes, deletes and failed requests, and keep them for 30 days. Plain reads that work are only counted, not listed."}
          </Empty>
        ) : (
          <>
            <ActivityTable rows={page.rows} />
            {page.next && (
              <Button variant="outline" className={cn("w-fit", TOUCH)} disabled={pending} onClick={() => load(filter, page.next!)}>
                {pending ? "Loading…" : "Load more"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
