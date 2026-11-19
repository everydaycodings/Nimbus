"use client"

import { CubeIcon, PlusIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { ActivityView } from "@/components/buckets/activity"
import { BucketTable } from "@/components/buckets/bucket-table"
import { Connect } from "@/components/buckets/connect"
import { KeyTable } from "@/components/buckets/key-table"
import { NewKey } from "@/components/buckets/new-key"
import { TABS, type Tab } from "@/components/buckets/tabs"
import { Overview } from "@/components/buckets/overview"
import { BucketDialog } from "@/components/s3-bucket-dialog"
import { Empty, Heading, SECTION } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import type { ActivityRow, Counts } from "@/lib/s3api/stats"

// Same segmented look as the registry's repository tabs; the choice lives in ?tab= so a tab can be linked to.
export function BucketTabs<T extends string>({ base, tab, tabs, label }: { base: string; tab: T; tabs: [T, string][]; label: string }) {
  const nav = useRef<HTMLElement>(null)
  // On a narrow screen the row scrolls; a fade on the right edge says there is more.
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = nav.current
    if (!el) return
    const check = () => setMore(el.scrollWidth - el.scrollLeft - el.clientWidth > 4)
    check()
    el.addEventListener("scroll", check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
    }
  }, [])
  return (
    <nav
      ref={nav}
      aria-label={label}
      className="flex w-fit max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]"
      style={more ? { maskImage: "linear-gradient(to right, black calc(100% - 2rem), transparent)" } : undefined}
    >
      {tabs.map(([id, text], i) => (
        <Link
          key={id}
          href={i === 0 ? base : `${base}?tab=${id}`}
          aria-current={tab === id ? "page" : undefined}
          className="flex h-7 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 aria-[current=page]:border-input aria-[current=page]:bg-input/30 aria-[current=page]:text-foreground"
        >
          {text}
        </Link>
      ))}
    </nav>
  )
}

export function BucketsShell({
  tab,
  totals,
  feed,
  buckets,
  keys,
  url,
  region,
  maxKeys,
}: {
  tab: Tab
  totals: (Counts & { requests: number }) | null
  feed: { rows: ActivityRow[]; next: string | null } | null
  buckets: BucketRow[]
  keys: KeyRow[]
  url: string
  region: string
  maxKeys: number
}) {
  const [newBucket, setNewBucket] = useState(false)
  // The key dialog: closed, or open with a bucket id to start from.
  const [newKey, setNewKey] = useState<{ preset: string | null } | null>(null)
  const setNotice = useNotice()
  const atMax = keys.length >= maxKeys
  const openKey = (preset: string | null) => setNewKey({ preset })
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">S3 buckets</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Let tools like the AWS CLI, rclone, restic and Terraform use your folders as S3 buckets.
          Files stay ordinary Nimbus files with versions, trash and sharing.
        </p>
      </header>
      <BucketTabs base="/buckets" tab={tab} tabs={TABS} label="S3 sections" />

      {tab === "overview" && (
        <Overview totals={totals} buckets={buckets} keys={keys} onNewBucket={() => setNewBucket(true)} onNewKey={() => openKey(null)} />
      )}

      {tab === "buckets" && (
        <section className={SECTION} aria-labelledby="buckets-heading">
          <Heading
            id="buckets-heading"
            title="Buckets"
            hint="Folders apps can reach. Mark any folder from its ⋯ menu, or make one here."
          >
            <Button onClick={() => setNewBucket(true)}>
              <PlusIcon />
              New bucket
            </Button>
          </Heading>
          {buckets.length === 0 ? (
            <Empty icon={CubeIcon} title="No buckets yet">
              A bucket is a folder S3 apps can read and write. Make one, then create an access key.
            </Empty>
          ) : (
            <BucketTable buckets={buckets} keys={keys} url={url} onNewKey={openKey} />
          )}
        </section>
      )}

      {tab === "keys" && (
        <section className={SECTION} aria-labelledby="keys-heading">
          <Heading
            id="keys-heading"
            title="Access keys"
            hint={`Apps sign in with a key, never your password or two-factor. Make one per app so you can revoke it alone. ${keys.length} of ${maxKeys} used.`}
          >
            <Button onClick={() => openKey(null)} disabled={atMax}>
              <PlusIcon />
              New access key
            </Button>
          </Heading>
          <KeyTable keys={keys} buckets={buckets} url={url} region={region} />
        </section>
      )}

      {tab === "connect" && <Connect url={url} region={region} buckets={buckets} />}

      {tab === "activity" && (
        <section className={SECTION} aria-labelledby="activity-heading">
          <Heading id="activity-heading" title="Activity" hint="What apps do with your buckets." />
          <ActivityView initial={feed} keys={keys} />
        </section>
      )}

      <BucketDialog
        open={newBucket}
        onClose={() => setNewBucket(false)}
        onDone={(name) => {
          setNewBucket(false)
          setNotice({ text: `“${name}” is now an S3 bucket.` })
        }}
      />
      <NewKey open={newKey !== null} preset={newKey?.preset} buckets={buckets} url={url} region={region} onClose={() => setNewKey(null)} />
    </div>
  )
}
