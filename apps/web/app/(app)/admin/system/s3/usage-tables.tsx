import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { TD, TH } from "@/components/buckets/table-styles"
import { formatBytes } from "@/lib/file-rules"
import type { AdminBucket, MemberUsage } from "@/lib/s3api/bucket-config"

const num = new Intl.NumberFormat("en")
// Scrolls inside the card on a phone, never the page.
const WRAP = "overflow-x-auto rounded-xl border bg-card"
const TABLE = "w-full min-w-max border-collapse text-sm"
const R = `${TH} text-right`

function Block({ title, description, empty, children }: { title: string; description: string; empty: string | null; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {empty ? <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">{empty}</p> : <div className={WRAP}>{children}</div>}
    </section>
  )
}

export function UsageByMember({ rows }: { rows: MemberUsage[] }) {
  return (
    <Block title="Usage by member (30 days)" description="Busiest first. Storage is what their buckets hold now." empty={rows.length ? null : "No one has used S3 yet."}>
      <table className={TABLE}>
        <caption className="sr-only">S3 usage by member over the last 30 days</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Member</th>
            <th scope="col" className={R}>Buckets</th>
            <th scope="col" className={R}>Storage</th>
            <th scope="col" className={R}>Requests</th>
            <th scope="col" className={R}>Data in</th>
            <th scope="col" className={R}>Data out</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {rows.map((r) => (
            <tr key={r.userId}>
              <th scope="row" className={`${TD} text-left font-normal`}>
                <Link href={`/admin/members/${r.userId}`} className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {r.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{r.email}</span>
              </th>
              <td className={`${TD} text-right`}>{num.format(r.buckets)}</td>
              <td className={`${TD} text-right`}>{formatBytes(r.storageBytes)}</td>
              <td className={`${TD} text-right`}>{num.format(r.requests)}</td>
              <td className={`${TD} text-right`}>{formatBytes(r.bytesIn)}</td>
              <td className={`${TD} text-right`}>{formatBytes(r.bytesOut)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

export function TopBuckets({ rows }: { rows: AdminBucket[] }) {
  return (
    <Block title="Top buckets" description="The largest buckets on the server." empty={rows.length ? null : "No buckets yet."}>
      <table className={TABLE}>
        <caption className="sr-only">Largest S3 buckets</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Bucket</th>
            <th scope="col" className={TH}>Member</th>
            <th scope="col" className={R}>Size</th>
            <th scope="col" className={R}>Requests (30 days)</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {rows.map((b) => (
            <tr key={b.id}>
              <th scope="row" className={`${TD} text-left font-normal`}>
                <span className="font-mono">{b.name}</span>
                {b.public && (
                  <Badge variant="outline" className="ml-2">
                    Public
                  </Badge>
                )}
              </th>
              <td className={TD}>
                <Link href={`/admin/members/${b.memberId}`} className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {b.member}
                </Link>
              </td>
              <td className={`${TD} text-right`}>{formatBytes(b.bytes)}</td>
              <td className={`${TD} text-right`}>{num.format(b.requests)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}
