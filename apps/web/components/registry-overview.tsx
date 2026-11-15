"use client"

import { GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { compareHref } from "@/components/registry-links"
import { PolicyBadge, type Verdict } from "@/components/registry-policy"
import { SeverityCompact, type ScanSummary } from "@/components/registry-scan"
import { CODE, DAY, LIST, Segmented, TOUCH, WHEN } from "@/components/registry-ui"
import { sizeOf } from "@/lib/registry/size"
import type { RepoDetail } from "@/lib/registry/manage"
import { cn } from "@/lib/utils"

// The repo's name, badges and one-line description: shown above every tab.
export function RepoHeader({ repo }: { repo: RepoDetail }) {
  return (
    <div className="grid gap-2">
      <h1 className="font-mono text-2xl font-semibold tracking-tight break-all">{repo.fullName}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {repo.isPublic ? <GlobeIcon /> : <LockSimpleIcon />}
          {repo.isPublic ? "Public" : "Private"}
        </Badge>
        {repo.archived && <Badge variant="secondary">Archived</Badge>}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-pretty break-words">
        {repo.description ? (
          repo.description
        ) : (
          <span className="text-muted-foreground">No description</span>
        )}
        {repo.canWrite && !repo.archived && (
          <Link
            href={`/registry/${repo.fullName}?tab=settings#general`}
            className={cn(
              "rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
            )}
          >
            {repo.description ? "Edit" : "Add one"}
          </Link>
        )}
      </p>
    </div>
  )
}

// A bar per day for the last 30 days: a glanceable shape, the chart below has the numbers.
function Spark({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <span aria-hidden className="flex h-5 w-full max-w-28 items-end gap-px">
      {days.map((d) => (
        <span
          key={d.day}
          className="min-w-px flex-1 rounded-t-[1px] bg-chart-1"
          style={{ height: d.count ? `max(2px, ${(d.count / max) * 100}%)` : 0 }}
        />
      ))}
    </span>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="grid min-w-0 gap-1 text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}

export function RepoStats({ repo, days }: { repo: RepoDetail; days: { day: string; count: number }[] }) {
  const last = repo.tags[0]?.pushedAt
  const pulls = days.reduce((a, d) => a + d.count, 0)
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      <Stat label="Last pushed">
        <span suppressHydrationWarning>{last ? WHEN.format(new Date(last)) : "Never"}</span>
      </Stat>
      <Stat label="Size">{sizeOf(repo.bytes)}</Stat>
      <Stat label="Tags">{repo.tags.length.toLocaleString()}</Stat>
      <Stat label="Pulls, 30 days">
        <span>{pulls.toLocaleString()}</span>
        {pulls > 0 && <Spark days={days} />}
      </Stat>
    </dl>
  )
}

// The command to run, in the usual block with Copy in the corner. By tag, or pinned to the digest.
export function PullCommand({ image, tag, digest }: { image: string; tag: string; digest: string }) {
  const [by, setBy] = useState<"tag" | "digest">("tag")
  const command = `docker pull ${image}${by === "tag" ? `:${tag}` : `@${digest}`}`
  return (
    <div className="grid content-start gap-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Pull this image</h2>
        <Segmented
          label="Pull by"
          value={by}
          options={[
            ["tag", `Tag ${tag.length > 14 ? `${tag.slice(0, 13)}…` : tag}`],
            ["digest", "Digest"],
          ]}
          onChange={setBy}
        />
      </div>
      <div className="relative">
        <code className={cn(CODE, "pt-12 whitespace-pre-wrap break-all sm:pr-24 sm:pt-3")}>{command}</code>
        <div className="absolute top-2 right-2">
          <CopyButton value={command} label="Copy pull command" className={TOUCH} />
        </div>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {by === "tag" ? "A tag can move to a newer image. Use the digest to pin this one." : "A digest always gives this exact image."}
      </p>
    </div>
  )
}

// The five newest tags, with a way into the full list.
export function RecentTags({
  repo,
  host,
  scans = {},
  verdicts = {},
  scanOn = false,
}: {
  repo: RepoDetail
  host: string
  // By tag name: the scan and policy answer for the tags shown.
  scans?: Record<string, ScanSummary | null>
  verdicts?: Record<string, Verdict | null>
  scanOn?: boolean
}) {
  const recent = repo.tags.slice(0, 5)
  return (
    <section className="grid content-start gap-2" aria-labelledby="recent-heading">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 id="recent-heading" className="text-base font-semibold">
          Recent tags
        </h2>
        <Link
          href={`/registry/${repo.fullName}?tab=tags`}
          className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          All tags{repo.tags.length > recent.length ? ` (${repo.tags.length})` : ""} →
        </Link>
      </div>
      <ul className={LIST}>
        {recent.map((t, i) => (
          <li key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <div className="grid min-w-0 flex-1 basis-44 gap-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <Link
                  href={`/registry/${repo.fullName}?tab=tags&tag=${encodeURIComponent(t.name)}`}
                  className="rounded-sm font-mono break-all underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                >
                  {t.name}
                </Link>
                {t.platforms.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">{t.platforms.length === 1 ? t.platforms[0] : `${t.platforms.length} platforms`}</span>
                )}
                <PolicyBadge v={verdicts[t.name]} />
              </p>
              <p suppressHydrationWarning className="text-xs text-muted-foreground">
                <span className="tabular-nums">{sizeOf(t.bytes)}</span> · {DAY.format(new Date(t.pushedAt))}
              </p>
              {(scanOn || scans[t.name]) && <SeverityCompact s={scans[t.name]} className="w-fit" />}
            </div>
            {recent[i + 1] && (
              <Link
                href={compareHref(repo.fullName, recent[i + 1].name, t.name)}
                aria-label={`Compare ${t.name} with ${recent[i + 1].name}`}
                className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                Compare
              </Link>
            )}
            <CopyButton value={`docker pull ${host}/${repo.fullName}:${t.name}`} label={`Copy pull command for ${t.name}`} className={TOUCH} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function MovedBanner({ from, until }: { from: string; until: string }) {
  return (
    <p role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-pretty">
      Moved from <span className="font-mono break-all">{from}</span>. Pulls of the old name keep working until{" "}
      <span suppressHydrationWarning>{DAY.format(new Date(until))}</span>.
    </p>
  )
}
