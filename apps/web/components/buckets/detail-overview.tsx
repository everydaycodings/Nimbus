import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { CopyButton } from "@/components/copy-button"
import { Heading, SECTION } from "@/components/registry-ui"
import { formatBytes } from "@/lib/file-rules"
import type { BucketRow } from "@/lib/s3api/manage"

const NUM = new Intl.NumberFormat("en")

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </dd>
    </div>
  )
}

export function DetailOverview({ b, url, region, usage }: { b: BucketRow & { allBytes: number }; url: string; region: string; usage: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      {b.gone && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-pretty text-muted-foreground">
          {b.role === "owner" ? "This bucket's folder is in the trash" : "This folder is no longer shared with you"}, so apps can&apos;t see
          this bucket. {b.role === "owner" ? "Restore the folder to use it again." : "Ask the owner to share it again."}
        </p>
      )}
      <section className={SECTION} aria-labelledby="size-heading">
        <Heading id="size-heading" title="Size" hint="What's in this bucket right now." />
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[
            ["Size", b.gone ? "–" : formatBytes(b.bytes), "Current files"],
            ["Objects", b.gone ? "–" : NUM.format(b.objects), "Files in the bucket"],
            ["With old versions", b.gone ? "–" : formatBytes(b.allBytes), "Counting every saved version"],
          ].map(([label, value, sub]) => (
            <div key={label} className="grid content-start gap-1 rounded-xl border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
              <dd className="text-xs text-muted-foreground">{sub}</dd>
            </div>
          ))}
        </dl>
      </section>
      {usage}
      <section className={SECTION} aria-labelledby="addr-heading">
        <Heading id="addr-heading" title="Connect" hint="Use these in an app, together with an access key." />
        <dl className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Endpoint" value={url} />
          </div>
          <Field label="Region" value={region} />
          <Field label="S3 address" value={`s3://${b.name}`} />
        </dl>
      </section>
      <section className={SECTION} aria-labelledby="folder-heading">
        <Heading id="folder-heading" title="Folder" hint="The files are an ordinary folder in Nimbus." />
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <FolderOpenIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words">{b.owner ? `${b.path} (shared by ${b.owner})` : b.path}</span>
          {!b.gone && (
            <Link
              href={`/folders/${b.nodeId}`}
              className="flex items-center rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
            >
              Open in Files
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
