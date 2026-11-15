import { CheckCircleIcon, QuestionIcon, XCircleIcon } from "@phosphor-icons/react/ssr"
import Link from "next/link"

import { CopyButton } from "@/components/copy-button"
import type { AdviceData } from "@/components/registry-advice"
import { baseName, fixSummary, isScanning, reasonOf } from "@/components/registry-links"
import { CheckList, type Verdict } from "@/components/registry-policy"
import { SeverityCounts, type ScanSummary } from "@/components/registry-scan"
import { TOUCH } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

const LINK =
  "rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"

// One verdict for the newest tag, at the top of a repo's Overview: the policy's answer, the scan, what fails,
// what to change. The scan counts show whenever a scan exists, even if the scanner is off now.
export function VerdictCard({
  name,
  namespace,
  tag,
  scan,
  scanOn,
  verdict,
  blocking,
  failingTags,
  checked,
  signed,
  sbom,
  advice,
  isOwner,
}: {
  name: string
  namespace: string
  tag: string
  scan: ScanSummary | null
  scanOn: boolean
  verdict: Verdict | null
  blocking: boolean
  // Of the newest `checked` tags, the ones that fail the policy.
  failingTags: string[]
  checked: number
  signed: boolean
  sbom: boolean
  advice: AdviceData | null
  isOwner: boolean
}) {
  const href = (view: string) =>
    `/registry/${name}?tab=tags&tag=${encodeURIComponent(tag)}&view=${view}#detail`
  const best = advice?.status === "ready" ? advice.suggestions[0] : undefined
  const fixes = best?.counts && advice?.current ? fixSummary(advice.current, best.counts) : ""
  const from = advice?.base && `${baseName(advice.base.name)}:${advice.base.tag}`
  const to = advice?.base && best && `${baseName(advice.base.name)}:${best.tag}`
  const done = scan?.status === "done"
  const head = !verdict
    ? { Icon: null, tone: "", text: "No image policy", sub: isOwner ? "Showing the scan only." : "Showing the scan only. An owner can set rules for this registry name." }
    : verdict.verdict === "pass"
      ? { Icon: CheckCircleIcon, tone: "text-brand", text: "Safe to deploy per your image policy", sub: blocking ? "Pulls of failing images are blocked." : "" }
      : verdict.verdict === "fail"
        ? { Icon: XCircleIcon, tone: "text-destructive", text: "Fails your image policy", sub: blocking ? "Pulls of this image are blocked." : "" }
        : { Icon: QuestionIcon, tone: "text-muted-foreground", text: "Not checked", sub: `${reasonOf(verdict)}. The policy can't judge this image yet.` }
  return (
    <section className="grid content-start gap-4 rounded-xl border bg-card p-4" aria-labelledby="health-heading">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="health-heading" className="text-base font-semibold">
          Image health{" "}
          <span className="font-mono text-sm font-normal text-muted-foreground">{tag}</span>
        </h2>
        <span className="flex flex-wrap items-center gap-x-4">
          {isOwner && (
            <Link href={`/registry?tab=access#policy-${namespace}`} className={LINK}>
              {verdict ? "Edit policy" : "Set a policy"}
            </Link>
          )}
          <Link href={href("packages")} className={LINK}>
            Packages →
          </Link>
        </span>
      </div>
      <div className="flex items-start gap-3">
        {head.Icon && <head.Icon aria-hidden className={`mt-0.5 size-6 shrink-0 ${head.tone}`} />}
        <div className="grid min-w-0 gap-0.5">
          <p className="text-lg font-semibold text-balance">{head.text}</p>
          {head.sub && <p className="text-sm text-pretty text-muted-foreground">{head.sub}</p>}
        </div>
      </div>
      <div className="text-sm">
        {done ? (
          <div className="grid gap-1">
            <Link href={href("overview")} className="w-fit rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <SeverityCounts c={scan!} />
            </Link>
            {!scanOn && scan?.scannedAt && (
              <span suppressHydrationWarning className="text-xs text-muted-foreground">
                From the last scan, {DAY.format(new Date(scan.scannedAt))}. Scanning is off now.
              </span>
            )}
          </div>
        ) : isScanning(scan) ? (
          <span className="text-muted-foreground">Scanning…</span>
        ) : scan?.status === "failed" ? (
          <span className="text-muted-foreground">The scan didn&apos;t finish</span>
        ) : (
          <span className="text-muted-foreground">{scanOn ? "Not scanned yet" : "Not scanned. Scanning is off on this server."}</span>
        )}
      </div>
      {verdict && verdict.checks.length > 0 && <CheckList checks={verdict.checks} />}
      {failingTags.length > 0 && (
        <p className="text-sm text-pretty">
          <span className="tabular-nums">
            {failingTags.length} of the {checked} newest {checked === 1 ? "tag fails" : "tags fail"} the policy:
          </span>{" "}
          {failingTags.slice(0, 6).map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <Link
                href={`/registry/${name}?tab=tags&tag=${encodeURIComponent(t)}#detail`}
                className="rounded-sm font-mono break-all underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {t}
              </Link>
            </span>
          ))}
          {failingTags.length > 6 && ` and ${failingTags.length - 6} more`}
        </p>
      )}
      {from && to && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1 basis-60 text-pretty">
            Change <code className="font-mono">FROM {from}</code> to{" "}
            <code className="font-mono">FROM {to}</code>
            {fixes && ` — fixes ${fixes}`}.
          </p>
          <CopyButton value={`FROM ${to}`} label={`Copy FROM ${to}`} text="Copy line" className={TOUCH} />
        </div>
      )}
      {advice?.base && !best && advice.status === "ready" && (
        <p className="text-xs text-muted-foreground">
          Base image <span className="font-mono">{from}</span> is up to date.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={signed ? undefined : "text-muted-foreground"}>
          {signed ? "Signed" : "Not signed"}
        </Badge>
        <Badge variant="outline" className={sbom ? undefined : "text-muted-foreground"}>
          {sbom ? "SBOM" : "No SBOM"}
        </Badge>
      </div>
    </section>
  )
}
