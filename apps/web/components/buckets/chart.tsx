"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { formatBytes } from "@/lib/file-types"
import type { Counts, Range } from "@/lib/s3api/stats"
import { cn } from "@/lib/utils"

export const RANGES = [
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["1y", "1 year"],
] as const satisfies readonly (readonly [Range, string])[]
export const RANGE_TEXT: Record<Range, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "1y": "last year" }

export type ChartPoint = { at: string } & Record<string, number | string>
export type Series = { key: string; label: string; color: 1 | 2 | 3 | 4 | 5 }

// Full class names, so Tailwind sees them.
const BG = { 1: "bg-chart-1", 2: "bg-chart-2", 3: "bg-chart-3", 4: "bg-chart-4", 5: "bg-chart-5" }

const HOUR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false, timeZone: "UTC" })
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const num = (p: ChartPoint, key: string) => Number(p[key]) || 0

export const NUM = new Intl.NumberFormat("en")
export const fmt = (v: number, format: "count" | "bytes") => (format === "bytes" ? formatBytes(v) : NUM.format(v))

export function Unavailable({ what }: { what: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-pretty text-muted-foreground">
      <WarningCircleIcon aria-hidden className="size-5 shrink-0" />
      Couldn&apos;t load {what}. Reload the page to try again.
    </p>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("grid animate-pulse gap-3 rounded-xl border bg-card p-4 motion-reduce:animate-none", className)}>
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="h-32 rounded bg-muted" />
    </div>
  )
}

// One column per step, stacked when there are several series. Hover or touch a column for its numbers.
// The table is for screen readers. `sum: false` is for sizes, where adding the steps up means nothing.
export function UsageChart({
  points,
  series,
  format,
  range,
  title,
  empty,
  sum = true,
}: {
  points: ChartPoint[]
  series: Series[]
  format: "count" | "bytes"
  range: Range
  title: string
  empty: string
  sum?: boolean
}) {
  const [at, setAt] = useState<number | null>(null)
  const hourly = range === "24h" || range === "7d"
  const when = (p: ChartPoint) => (hourly ? `${HOUR.format(new Date(p.at))} UTC` : DAY.format(new Date(p.at.length === 10 ? `${p.at}T00:00:00Z` : p.at)))
  const stack = (p: ChartPoint) => series.reduce((a, s) => a + num(p, s.key), 0)
  const max = Math.max(0, ...points.map(stack))
  if (!max)
    return (
      <div className="grid gap-1 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{empty}</p>
      </div>
    )
  const top = format === "bytes" || max < 10 ? max : Math.ceil(max / 10) * 10
  const hit = at === null ? null : points[at]
  const last = points[points.length - 1]
  const value = (s: Series) => (hit ? num(hit, s.key) : sum ? points.reduce((a, p) => a + num(p, s.key), 0) : num(last, s.key))
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground tabular-nums">{hit ? when(hit) : sum ? RANGE_TEXT[range] : "Latest"}</p>
      </div>
      <ul aria-live="off" className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-sm", BG[s.color])} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium">{fmt(value(s), format)}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className="flex h-32 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums">
          <span>{fmt(top, format)}</span>
          <span>0</span>
        </div>
        <div aria-hidden className="relative flex h-32 items-end gap-px border-b" onPointerLeave={() => setAt(null)}>
          <span className="absolute inset-x-0 top-0 border-t" />
          {points.map((p, i) => (
            <div
              key={p.at}
              className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              onPointerEnter={() => setAt(i)}
              onPointerDown={() => setAt(i)}
            >
              <div
                className={cn(
                  "flex w-full max-w-4 flex-col-reverse overflow-hidden rounded-t-[4px] transition-opacity motion-reduce:transition-none",
                  at !== null && at !== i && "opacity-40"
                )}
                style={{ height: stack(p) ? `max(2px, ${(stack(p) / top) * 100}%)` : 0 }}
              >
                {series.map((s) => (
                  <span key={s.key} className={BG[s.color]} style={{ flexGrow: num(p, s.key), flexBasis: 0 }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <span />
        <div aria-hidden className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{when(points[0])}</span>
          <span>{when(last)}</span>
        </div>
      </div>
      {/* sr-only on the <table> itself lets Chrome paint the caption on top of the chart. */}
      <div className="sr-only">
        <table>
          <caption>
            {title}, {RANGE_TEXT[range]}
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.at}>
                <th scope="row">{when(p)}</th>
                {series.map((s) => (
                  <td key={s.key}>{fmt(num(p, s.key), format)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TotalCards({ t }: { t: Counts & { requests: number } }) {
  const stats = [
    ["Requests", NUM.format(t.requests), `${NUM.format(t.reads)} reads, ${NUM.format(t.writes)} writes`],
    ["Data in", fmt(t.bytesIn, "bytes"), "Uploaded"],
    ["Data out", fmt(t.bytesOut, "bytes"), "Downloaded"],
    ["Errors", NUM.format(t.e4xx + t.e5xx), `${NUM.format(t.e4xx)} client, ${NUM.format(t.e5xx)} server`],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(([label, value, sub]) => (
        <div key={label} className="grid content-start gap-1 rounded-xl border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
          <dd className="text-xs text-muted-foreground">{sub}</dd>
        </div>
      ))}
    </dl>
  )
}
