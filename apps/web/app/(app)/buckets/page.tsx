import { CubeIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { BucketsView } from "@/components/buckets-view"
import { isAdmin, requireMember } from "@/lib/session"
import { listBuckets, listKeys, s3State, type S3State } from "@/lib/s3api/manage"
import { MAX_KEYS_PER_MEMBER, REGION, endpoint } from "@/lib/s3api/rules"

export const metadata = { title: "S3 buckets · Nimbus" }

const COPY = (admin: boolean): Record<Exclude<S3State, "ready">, { title: string; body: React.ReactNode }> => ({
  unset: {
    title: "S3 isn't set up on this server",
    body: admin
      ? "Re-run setup.sh and answer yes to the S3 question. Nimbus then serves an S3 address and this page starts working."
      : "An admin has to turn it on when setting up Nimbus. Ask them if you need it.",
  },
  off: {
    title: "S3 is turned off",
    body: admin ? (
      <>
        You turned the S3 API off for everyone. Turn it back on in{" "}
        <Link
          href="/admin/system/s3"
          className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Admin → S3 API
        </Link>
        .
      </>
    ) : (
      "An admin turned the S3 API off. Your buckets and keys are kept and work again when it's back on."
    ),
  },
  disabled: {
    title: "S3 is off for your account",
    body: "An admin turned it off for you, and your access keys were removed. Ask them if you need it back.",
  },
})

export default async function BucketsPage() {
  const me = await requireMember()
  const state = await s3State(me.id)
  if (state !== "ready") {
    const { title, body } = COPY(isAdmin(me.role))[state]
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">S3 buckets</h1>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-16 text-center">
          <CubeIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">{title}</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">{body}</p>
        </div>
      </div>
    )
  }
  const [buckets, keys] = await Promise.all([listBuckets(me.id), listKeys(me.id)])
  return (
    <BucketsView
      buckets={buckets}
      keys={keys}
      url={endpoint()!}
      region={REGION}
      maxKeys={MAX_KEYS_PER_MEMBER}
    />
  )
}
