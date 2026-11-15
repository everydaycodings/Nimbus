"use client"

import { useState } from "react"

import { CopyButton } from "@/components/copy-button"
import { TOUCH, WHEN } from "@/components/registry-ui"
import { cn } from "@/lib/utils"

export type Artifact = { digest: string; artifactType: string | null; kind: string; createdAt: Date | string }

const KIND: Record<string, string> = { signature: "Signature", sbom: "SBOM", attestation: "Attestation" }
const shortDigest = (d: string) => `${d.slice(0, 14)}…${d.slice(-4)}`
// application/vnd.dev.cosign.artifact.sbom.v1+json -> cosign.artifact.sbom.v1+json
const typeOf = (t: string | null) => (t ? t.replace(/^application\/vnd\./, "") : "none")

// What is attached to the selected tag: signatures, SBOMs and attestations.
export function ArtifactList({ items, tag }: { items: Artifact[]; tag: string }) {
  if (items.length === 0) return null
  return (
    <div className="grid gap-1.5">
      <h4 className="text-sm font-medium">Signatures and attachments</h4>
      <ul className="divide-y overflow-hidden rounded-md border text-xs">
        {items.map((a) => (
          <li key={a.digest} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
            <span className="w-24 shrink-0 font-medium">{KIND[a.kind] ?? a.kind}</span>
            <span className="min-w-0 flex-1 basis-40 font-mono break-all text-muted-foreground">{typeOf(a.artifactType)}</span>
            <code className="font-mono text-muted-foreground" title={a.digest}>
              {shortDigest(a.digest)}
            </code>
            <span suppressHydrationWarning className="text-muted-foreground">
              {WHEN.format(new Date(a.createdAt))}
            </span>
            <CopyButton value={a.digest} label={`Copy digest of ${KIND[a.kind] ?? a.kind} for ${tag}`} className={cn("h-7", TOUCH)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
const dayOf = (d: string) => DAY.format(new Date(`${d}T00:00:00Z`))
const pulls = (n: number) => (n === 1 ? "1 pull" : `${n.toLocaleString()} pulls`)

// Thirty columns on one baseline, one series: hover or touch a column for its day. The table is for screen readers.
export function PullsChart({ days }: { days: { day: string; count: number }[] }) {
  const [at, setAt] = useState<number | null>(null)
  const total = days.reduce((a, d) => a + d.count, 0)
  const max = Math.max(1, ...days.map((d) => d.count))
  const top = max < 10 ? max : Math.ceil(max / 10) * 10
  const hit = at === null ? null : days[at]
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <p aria-live="off" className="text-sm tabular-nums">
        {hit ? (
          <>
            <span className="font-medium">{pulls(hit.count)}</span> <span className="text-muted-foreground">on {dayOf(hit.day)}</span>
          </>
        ) : (
          <>
            <span className="font-medium">{pulls(total)}</span> <span className="text-muted-foreground">in the last {days.length} days</span>
          </>
        )}
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className="flex h-32 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums">
          <span>{top.toLocaleString()}</span>
          <span>0</span>
        </div>
        <div
          aria-hidden
          className="relative flex h-32 items-end gap-0.5 border-b"
          onPointerLeave={() => setAt(null)}
        >
          <span className="absolute inset-x-0 top-0 border-t" />
          {days.map((d, i) => (
            <div
              key={d.day}
              className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              onPointerEnter={() => setAt(i)}
              onPointerDown={() => setAt(i)}
            >
              <span
                className={cn(
                  "block w-full max-w-4 rounded-t-[4px] bg-chart-1 transition-opacity motion-reduce:transition-none",
                  at !== null && at !== i && "opacity-40"
                )}
                style={{ height: d.count ? `max(2px, ${(d.count / top) * 100}%)` : 0 }}
              />
            </div>
          ))}
        </div>
        <span />
        <div aria-hidden className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{dayOf(days[0].day)}</span>
          <span>{dayOf(days[days.length - 1].day)}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Pulls per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayOf(d.day)}</th>
              <td>{pulls(d.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
