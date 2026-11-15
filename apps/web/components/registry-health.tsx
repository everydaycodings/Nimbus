import Link from "next/link"

import { Delta, type AdviceData } from "@/components/registry-advice"
import { PolicyBadge, type Verdict } from "@/components/registry-policy"
import {
  SeverityCounts,
  isScanning,
  type ScanSummary,
} from "@/components/registry-scan"
import { Badge } from "@/components/ui/badge"

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

// A short read on the newest tag: vulnerabilities, policy, what's attached, and a better base image if one is known.
export function ImageHealth({
  name,
  tag,
  scan,
  scanOn,
  verdict,
  signed,
  sbom,
  advice,
}: {
  name: string
  tag: string
  scan: ScanSummary | null
  scanOn: boolean
  verdict: Verdict | null
  signed: boolean
  sbom: boolean
  advice: AdviceData | null
}) {
  const href = (view: string) =>
    `/registry/${name}?tab=tags&tag=${encodeURIComponent(tag)}&view=${view}#detail`
  const best = advice?.status === "ready" ? advice.suggestions[0] : undefined
  return (
    <section
      className="grid content-start gap-2"
      aria-labelledby="health-heading"
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 id="health-heading" className="text-base font-semibold">
          Image health{" "}
          <span className="font-mono text-sm font-normal text-muted-foreground">
            {tag}
          </span>
        </h2>
        <Link
          href={href("packages")}
          className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          Packages →
        </Link>
      </div>
      <dl className="divide-y overflow-hidden rounded-xl border bg-card">
        {scanOn && (
          <Row label="Vulnerabilities">
            {!scan ? (
              <span className="text-muted-foreground">Not scanned</span>
            ) : (scan.status === "pending" || scan.status === "running") ? (
              <span className="text-muted-foreground">Scanning…</span>
            ) : scan.status === "failed" ? (
              <span className="text-muted-foreground">
                The scan didn&apos;t finish
              </span>
            ) : (
              <Link
                href={href("overview")}
                className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <SeverityCounts c={scan} />
              </Link>
            )}
          </Row>
        )}
        {verdict && (
          <Row label="Policy">
            <span className="flex flex-wrap items-center gap-2">
              <PolicyBadge v={verdict} />
              {!verdict.pass && (
                <span className="text-xs text-muted-foreground">
                  {verdict.checks.find((c) => !c.pass)?.detail}
                </span>
              )}
            </span>
          </Row>
        )}
        <Row label="Attached">
          <span className="flex flex-wrap gap-1.5">
            <Badge
              variant="outline"
              className={signed ? undefined : "text-muted-foreground"}
            >
              {signed ? "Signed" : "Not signed"}
            </Badge>
            <Badge
              variant="outline"
              className={sbom ? undefined : "text-muted-foreground"}
            >
              {sbom ? "SBOM" : "No SBOM"}
            </Badge>
          </span>
        </Row>
        {advice?.base && (
          <Row label="Base image">
            <span className="grid gap-1">
              <span>
                <span className="font-mono break-all">
                  {advice.base.name}:{advice.base.tag}
                </span>{" "}
                {best ? (
                  <Link
                    href={href("base")}
                    className="text-xs underline underline-offset-4"
                  >
                    Update to <span className="font-mono">{best.tag}</span>
                  </Link>
                ) : advice.status === "ready" ? (
                  <span className="text-xs text-muted-foreground">
                    Up to date
                  </span>
                ) : null}
              </span>
              {best?.counts && advice.current && (
                <span className="text-xs text-muted-foreground">
                  <Delta from={advice.current} to={best.counts} />
                </span>
              )}
            </span>
          </Row>
        )}
      </dl>
    </section>
  )
}
