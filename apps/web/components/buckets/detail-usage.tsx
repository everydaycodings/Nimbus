import { ChartLineIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { ActivityTable } from "@/components/buckets/activity"
import { ChartSkeleton, TotalCards, Unavailable, UsageChart, type Series } from "@/components/buckets/chart"
import { RangePicker } from "@/components/buckets/range-picker"
import { Empty, Heading, SECTION } from "@/components/registry-ui"
import { activity, storageTrend, top, totals, usage, type Range, type Top } from "@/lib/s3api/stats"

const NUM = new Intl.NumberFormat("en")
export const NO_REQUESTS = "No requests yet. Numbers appear about a minute after your first request."

export function UsageSkeleton({ cards }: { cards?: boolean }) {
  return (
    <div className="grid gap-3">
      {cards && (
        <div className="grid animate-pulse grid-cols-2 gap-3 motion-reduce:animate-none lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl border bg-card" />
          ))}
        </div>
      )}
      <ChartSkeleton />
    </div>
  )
}

const REQUESTS: Series[] = [
  { key: "reads", label: "Reads", color: 1 },
  { key: "writes", label: "Writes", color: 2 },
  { key: "lists", label: "Lists", color: 3 },
  { key: "deletes", label: "Deletes", color: 4 },
]
const BANDWIDTH: Series[] = [
  { key: "bytesIn", label: "In", color: 1 },
  { key: "bytesOut", label: "Out", color: 2 },
]
const ERRORS: Series[] = [
  { key: "e4xx", label: "4xx client errors", color: 3 },
  { key: "e5xx", label: "5xx server errors", color: 5 },
]

function TopList({ title, rows }: { title: string; rows: Top[] }) {
  return (
    <div className="grid content-start gap-2 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ol className="grid gap-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.id ?? r.label} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{NUM.format(r.requests)} requests</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Overview tab: 30-day numbers, size over time, busiest callers and the latest activity.
// The last 30 days of size, one bar a day: the daily snapshots, with today's live size last.
function sizeDays(trend: { day: string; bytes: number }[], now: number) {
  const by = new Map(trend.map((s) => [s.day, s.bytes]))
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(today - (29 - i) * 86_400_000).toISOString().slice(0, 10)
    return { at: day, bytes: i === 29 ? now : (by.get(day) ?? 0) }
  })
}

export async function BucketUsage({ userId, bucketId, name, bytes }: { userId: string; bucketId: string; name: string; bytes: number }) {
  const scope = { userId, bucketId }
  let d
  try {
    d = await Promise.all([
      totals(scope, "30d"),
      storageTrend(userId, bucketId),
      top(scope, "key", "30d"),
      top(scope, "ip", "30d"),
      top(scope, "agent", "30d"),
      activity(scope, {}, undefined, 5),
    ])
  } catch {
    return <Unavailable what="usage" />
  }
  const [t, trend, keys, ips, agents, recent] = d
  return (
    <>
      <section className={SECTION} aria-labelledby="use-heading">
        <Heading id="use-heading" title="Last 30 days" hint="What apps did with this bucket." />
        <TotalCards t={t} />
        <UsageChart
          title="Size"
          points={sizeDays(trend, bytes)}
          series={[{ key: "bytes", label: "Size", color: 1 }]}
          format="bytes"
          range="30d"
          empty="This bucket is empty."
          sum={false}
        />
      </section>
      <section className={SECTION} aria-labelledby="top-heading">
        <Heading id="top-heading" title="Busiest" hint="Who used this bucket the most in the last 30 days." />
        <div className="grid gap-3 md:grid-cols-3">
          <TopList title="Access keys" rows={keys} />
          <TopList title="Addresses" rows={ips} />
          <TopList title="Apps" rows={agents} />
        </div>
      </section>
      <section className={SECTION} aria-labelledby="recent-heading">
        <Heading id="recent-heading" title="Recent activity" hint="Writes and failed requests.">
          <Link
            href={`/buckets?tab=activity&bucket=${encodeURIComponent(name)}`}
            className="flex items-center rounded-sm text-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
          >
            See all activity
          </Link>
        </Heading>
        {recent.rows.length ? <ActivityTable rows={recent.rows} hideBucket /> : <p className="text-sm text-muted-foreground">Nothing logged yet.</p>}
      </section>
    </>
  )
}

// Metrics tab: three charts for the chosen range.
export async function BucketMetrics({ userId, bucketId, range }: { userId: string; bucketId: string; range: Range }) {
  let points
  try {
    points = await usage({ userId, bucketId }, range)
  } catch {
    return <Unavailable what="metrics" />
  }
  if (!points.some((p) => p.reads + p.writes + p.lists + p.deletes))
    return (
      <Empty icon={ChartLineIcon} title="No requests yet">
        Numbers appear about a minute after your first request.
      </Empty>
    )
  return (
    <div className="grid gap-3">
      <UsageChart title="Requests" points={points} series={REQUESTS} format="count" range={range} empty={NO_REQUESTS} />
      <UsageChart title="Data moved" points={points} series={BANDWIDTH} format="bytes" range={range} empty={NO_REQUESTS} />
      <UsageChart title="Errors" points={points} series={ERRORS} format="count" range={range} empty="No errors in this range." />
    </div>
  )
}

export function MetricsHeading({ base, range }: { base: string; range: Range }) {
  return (
    <Heading id="metrics-heading" title="Metrics" hint="Requests and data moved in and out. Hourly up to 7 days, daily after that.">
      <RangePicker base={base} range={range} />
    </Heading>
  )
}
