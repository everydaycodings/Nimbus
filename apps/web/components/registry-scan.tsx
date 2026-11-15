"use client"

import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { rescanTag } from "@/app/(app)/registry/actions"
import { TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ScanSummary = { status: "pending" | "running" | "done" | "failed"; critical: number; high: number; medium: number; low: number }
export type Vuln = { id: string; pkg: string; installed: string; fixed: string | null; severity: string; title: string | null }

const SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const
type Sev = (typeof SEVERITIES)[number]
const LABEL: Record<Sev, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", unknown: "Unknown" }
// The coloured dot carries the severity; the words stay in text colours.
const DOT: Record<Sev, string> = { critical: "bg-destructive", high: "bg-warning", medium: "bg-chart-3", low: "bg-muted-foreground", unknown: "bg-border" }

const Dot = ({ sev }: { sev: Sev }) => <span aria-hidden className={cn("size-2 rounded-full", DOT[sev])} />

export type Counts = { critical: number; high: number; medium: number; low: number }

// The four counts as dot + number + word, quiet when zero.
export function SeverityCounts({ c, className }: { c: Counts; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {(["critical", "high", "medium", "low"] as const).map((s) => (
        <span key={s} className={cn("inline-flex items-center gap-1.5 tabular-nums", c[s] === 0 && "text-muted-foreground")}>
          <Dot sev={s} />
          {c[s]} {LABEL[s]}
        </span>
      ))}
    </span>
  )
}

export const isScanning = (s?: ScanSummary | null) => s?.status === "pending" || s?.status === "running"

// A scan summary as it sits in a tag row.
export function ScanBadge({ s }: { s: ScanSummary | null | undefined }) {
  if (!s) return <span className="text-xs text-muted-foreground">Not scanned</span>
  if (isScanning(s))
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Scanning…
      </Badge>
    )
  if (s.status === "failed")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Scan failed
      </Badge>
    )
  if (!s.critical && !s.high)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        No critical or high
      </Badge>
    )
  return (
    <Badge variant="outline" aria-label={`${s.critical} critical, ${s.high} high vulnerabilities`}>
      {s.critical > 0 && (
        <>
          <Dot sev="critical" />
          <span className="tabular-nums">{s.critical}</span> Critical
        </>
      )}
      {s.high > 0 && (
        <>
          <Dot sev="high" />
          <span className="tabular-nums">{s.high}</span> High
        </>
      )}
    </Badge>
  )
}

const PAGE = 50
const cveLink = (id: string) => (/^CVE-/i.test(id) ? `https://avd.aquasec.com/nvd/${id.toLowerCase()}` : null)

// The selected tag's findings: counts as filters, then the list.
export function VulnList({
  tag,
  name,
  summary,
  vulns,
  error,
  canRescan,
  title = "Vulnerabilities",
  empty = "No known vulnerabilities found.",
}: {
  title?: string
  empty?: string
  tag: string
  name: string
  summary: ScanSummary | null
  vulns: Vuln[]
  error: string | null
  canRescan: boolean
}) {
  const [sev, setSev] = useState<Sev | null>(null)
  const [more, setMore] = useState(false)
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const router = useRouter()
  const scanning = isScanning(summary)
  const rows = vulns.filter((v) => !sev || v.severity.toLowerCase() === sev)
  const shown = more ? rows : rows.slice(0, PAGE)
  const count = (s: Sev) => vulns.filter((v) => v.severity.toLowerCase() === s).length
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="mr-auto flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheckIcon className="size-4 text-muted-foreground" />
          {title}
        </h4>
        {canRescan && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={TOUCH}
            disabled={pending || scanning}
            aria-label={`Rescan ${tag}`}
            onClick={() =>
              start(async () => {
                const r = await rescanTag(name, tag)
                setNotice(r.error ? { text: r.error, error: true } : { text: `Scanning ${tag} again.` })
                router.refresh()
              })
            }
          >
            <ArrowClockwiseIcon />
            Rescan
          </Button>
        )}
      </div>
      {scanning ? (
        <p className="text-sm text-muted-foreground">Scanning… this page updates when it&apos;s done.</p>
      ) : !summary ? (
        <p className="text-sm text-muted-foreground">This image hasn&apos;t been scanned yet.{canRescan ? " Rescan to check it now." : ""}</p>
      ) : summary.status === "failed" || error ? (
        <p className="text-sm text-pretty text-muted-foreground">The scan didn&apos;t finish{error ? `: ${error}` : "."}</p>
      ) : vulns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sev === s}
                disabled={count(s) === 0}
                onClick={() => (setSev(sev === s ? null : s), setMore(false))}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-pressed:border-ring/60 aria-pressed:bg-input/30 pointer-coarse:h-11 pointer-coarse:px-3"
              >
                <Dot sev={s} />
                {LABEL[s]} <span className="text-muted-foreground tabular-nums">{count(s)}</span>
              </button>
            ))}
          </div>
          <ul className="divide-y overflow-hidden rounded-md border text-xs">
            {shown.map((v, i) => {
              const s = (SEVERITIES.find((x) => x === v.severity.toLowerCase()) ?? "unknown") as Sev
              const link = cveLink(v.id)
              return (
                <li key={`${v.id}-${v.pkg}-${i}`} className="grid gap-1 px-3 py-2">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex w-16 items-center gap-1.5 font-medium">
                      <Dot sev={s} />
                      {LABEL[s]}
                    </span>
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-sm font-mono underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        {v.id}
                      </a>
                    ) : (
                      <span className="font-mono">{v.id}</span>
                    )}
                    <span className="font-mono break-all text-muted-foreground">
                      {v.pkg} {v.installed} → {v.fixed ?? "no fix yet"}
                    </span>
                  </p>
                  {v.title && <p className="text-pretty text-muted-foreground">{v.title}</p>}
                </li>
              )
            })}
          </ul>
          {rows.length > shown.length && (
            <Button type="button" variant="outline" size="sm" className={cn(TOUCH, "w-fit")} onClick={() => setMore(true)}>
              Show all {rows.length}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
