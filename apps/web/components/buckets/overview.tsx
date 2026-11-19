"use client"

import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react"
import Link from "next/link"

import { Heading, SECTION, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-types"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import { cn } from "@/lib/utils"

const NUM = new Intl.NumberFormat("en")

function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  return (
    <div className="relative grid content-start gap-1 rounded-xl border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
      {href && (
        <Link href={href} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span className="sr-only">Review access keys</span>
        </Link>
      )}
    </div>
  )
}

export function Overview({
  buckets,
  keys,
  onNewBucket,
  onNewKey,
}: {
  buckets: BucketRow[]
  keys: KeyRow[]
  onNewBucket: () => void
  onNewKey: () => void
}) {
  const live = buckets.filter((b) => !b.gone)
  const active = keys.filter((k) => !k.expired).length
  const expired = keys.length - active
  const due = keys.filter((k) => k.rotationDue).length
  const soon = keys.filter((k) => k.expiringSoon).length
  const steps = [
    {
      done: buckets.length > 0,
      title: "Make a bucket",
      body: "A bucket is one of your folders that apps can reach.",
      action: (
        <Button size="sm" className={TOUCH} onClick={onNewBucket}>
          New bucket
        </Button>
      ),
    },
    {
      done: active > 0,
      title: "Make an access key",
      body: "Apps sign in with a key instead of your password.",
      action: (
        <Button size="sm" className={TOUCH} onClick={onNewKey}>
          New access key
        </Button>
      ),
    },
    {
      done: keys.some((k) => k.lastUsedAt),
      title: "Connect an app",
      body: "Give the app the address and your key. We have snippets for the common tools.",
      action: (
        <Button size="sm" variant="outline" className={TOUCH} nativeButton={false} render={<Link href="/buckets?tab=connect" />}>
          Show me how
        </Button>
      ),
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <section className={SECTION} aria-labelledby="totals-heading">
        <Heading id="totals-heading" title="At a glance" hint="Everything in your buckets, added up." />
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Storage" value={formatBytes(live.reduce((n, b) => n + b.bytes, 0))} />
          <Stat label="Objects" value={NUM.format(live.reduce((n, b) => n + b.objects, 0))} sub="Files in your buckets" />
          <Stat label="Buckets" value={NUM.format(buckets.length)} />
          <Stat
            label="Access keys"
            value={NUM.format(active)}
            sub={expired ? `${NUM.format(expired)} expired` : "Active"}
          />
          {(due > 0 || soon > 0) && (
            <Stat
              label="Needs attention"
              value={NUM.format(due + soon)}
              sub={[due && `${due} to rotate`, soon && `${soon} expiring soon`].filter(Boolean).join(" · ")}
              href="/buckets?tab=keys"
            />
          )}
        </dl>
      </section>

      {steps.some((s) => !s.done) && (
        <section className={SECTION} aria-labelledby="setup-heading">
          <Heading id="setup-heading" title="Get started" hint="Three steps from nothing to an app saving files here." />
          <ol className="divide-y overflow-hidden rounded-xl border bg-card">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                {s.done ? (
                  <CheckCircleIcon aria-hidden weight="fill" className="size-5 shrink-0 text-brand" />
                ) : (
                  <CircleIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                )}
                <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                  <p className={cn("text-sm font-medium", s.done && "text-muted-foreground")}>
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                    {s.done && <span className="sr-only"> (done)</span>}
                  </p>
                  <p className="text-xs text-pretty text-muted-foreground">{s.body}</p>
                </div>
                {!s.done && s.action}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={SECTION} aria-labelledby="what-heading">
        <Heading id="what-heading" title="What is S3?" hint="A short guide if this is new to you." />
        <div className="grid max-w-prose gap-2 rounded-xl border bg-card p-4 text-sm text-pretty text-muted-foreground">
          <p>
            S3 is the way many apps and backup tools store files. Instead of opening a folder on your
            computer, the app talks to an address on the internet.
          </p>
          <p>
            To get in, it needs a <strong className="font-medium text-foreground">key</strong>, which works like a
            username and password made for that one app. You can revoke a key any time without
            changing your own password.
          </p>
          <p>
            Here, a <strong className="font-medium text-foreground">bucket</strong> is simply one of your folders. The
            files stay ordinary Nimbus files, so you still see them in Files with versions, trash and
            sharing.
          </p>
        </div>
      </section>
    </div>
  )
}
