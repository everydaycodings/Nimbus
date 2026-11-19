import { ArrowLeftIcon, CubeIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"

import { DetailAccess } from "@/components/buckets/detail-access"
import { DetailOverview } from "@/components/buckets/detail-overview"
import { BucketMetrics, BucketUsage, MetricsHeading, UsageSkeleton } from "@/components/buckets/detail-usage"
import { DetailSettings } from "@/components/buckets/detail-settings"
import { ObjectBrowser } from "@/components/buckets/objects"
import { BucketTabs } from "@/components/buckets/shell"
import { Empty, SECTION } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { isAdmin, requireMember } from "@/lib/session"
import { getBucketConfig } from "@/lib/s3api/bucket-config"
import { bucketDetail, listBuckets, listKeys, listObjects, s3State } from "@/lib/s3api/manage"
import { MAX_KEYS_PER_MEMBER, REGION, endpoint, keyReaches } from "@/lib/s3api/rules"
import type { Range } from "@/lib/s3api/stats"

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: `${(await params).name} · S3 buckets · Nimbus` }
}

const TABS = [
  ["overview", "Overview"],
  ["objects", "Objects"],
  ["metrics", "Metrics"],
  ["access", "Access"],
  ["settings", "Settings"],
] as const
type Tab = (typeof TABS)[number][0]

export default async function BucketPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>
  searchParams: Promise<{ tab?: string; prefix?: string; range?: string }>
}) {
  const me = await requireMember()
  // The list page explains why S3 isn't usable.
  if ((await s3State(me.id)) !== "ready") redirect("/buckets")
  const { name } = await params
  const [b, sp] = [await bucketDetail(me.id, name), await searchParams]
  if (!b) notFound()
  const tab: Tab = TABS.find(([t]) => t === sp.tab)?.[0] ?? "overview"
  const range = (["24h", "7d", "30d", "1y"] as const).find((r) => r === sp.range) ?? ("7d" satisfies Range)
  const url = endpoint()!
  const allKeys = tab === "objects" || tab === "access" ? await listKeys(me.id) : []
  const keys = allKeys.filter((k) => keyReaches(k, b.name))
  // A folder path as S3 writes it: no leading slash, one trailing.
  const prefix = (sp.prefix ?? "").replace(/^\/+/, "").replace(/([^/])$/, "$1/")
  const objects = tab === "objects" && !b.gone ? await listObjects(me.id, b.id, prefix) : null

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-3">
        <Link
          href="/buckets?tab=buckets"
          className="flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          <ArrowLeftIcon className="size-3.5" />
          S3 buckets
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight break-all">{b.name}</h1>
          {b.role === "viewer" && <Badge variant="outline">Read only</Badge>}
          {b.gone && <Badge variant="secondary">Hidden</Badge>}
        </div>
      </header>
      <BucketTabs base={`/buckets/${b.name}`} tab={tab} tabs={TABS.map(([t, l]) => [t, l])} label="Bucket sections" />

      {tab === "overview" && (
        <DetailOverview
          b={b}
          url={url}
          region={REGION}
          usage={
            b.gone ? null : (
              <Suspense fallback={<UsageSkeleton cards />}>
                <BucketUsage userId={me.id} bucketId={b.id} name={b.name} bytes={b.bytes} />
              </Suspense>
            )
          }
        />
      )}
      {tab === "objects" &&
        (objects ? (
          <ObjectBrowser key={prefix} bucket={{ id: b.id, name: b.name }} prefix={prefix} initial={objects} canShare={keys.length > 0} />
        ) : (
          <Empty icon={CubeIcon} title="Can't list this bucket">
            Its folder is in the trash or no longer shared with you, so there is nothing to show.
          </Empty>
        ))}
      {tab === "metrics" && (
        <section className={SECTION} aria-labelledby="metrics-heading">
          <MetricsHeading base={`/buckets/${b.name}?tab=metrics`} range={range} />
          <Suspense key={range} fallback={<UsageSkeleton />}>
            <BucketMetrics userId={me.id} bucketId={b.id} range={range} />
          </Suspense>
        </section>
      )}
      {tab === "access" && (
        <DetailAccess
          bucket={b}
          buckets={await listBuckets(me.id)}
          keys={keys}
          atMax={allKeys.length >= MAX_KEYS_PER_MEMBER}
          url={url}
          region={REGION}
        />
      )}
      {tab === "settings" && <Settings me={me} b={b} />}
    </div>
  )
}

async function Settings({ me, b }: { me: Awaited<ReturnType<typeof requireMember>>; b: NonNullable<Awaited<ReturnType<typeof bucketDetail>>> }) {
  const c = await getBucketConfig(me.id, b.id)
  if (!c) notFound()
  return <DetailSettings key={b.name} b={b} c={c} admin={isAdmin(me.role)} />
}
