import { eq } from "drizzle-orm"
import Link from "next/link"
import { notFound } from "next/navigation"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { StorageMeter } from "@/components/storage-meter"
import { StorageReport } from "@/components/storage-report"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/session"
import { report } from "@/lib/storage-report"
import { remindStorage } from "../../actions"

export const metadata = { title: "Member storage · Admin · Nimbus" }

// View only: admins see what fills a member's space but can't touch their files.
export default async function MemberStoragePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ folder?: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const { folder } = await searchParams
  const [p] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, id))
  if (!p) notFound()
  const r = await report(p.id, typeof folder === "string" ? folder : null)
  const base = `/admin/members/${p.id}/storage`

  return (
    <AdminPage
      wide
      title={`Storage of ${p.name}`}
      description={`${p.email} · View only. Members delete things themselves from their own Storage page.`}
      back={{ href: `/admin/members/${p.id}`, label: p.name }}
    >
      <div
        className={`${FRAME} flex flex-wrap items-center gap-x-6 gap-y-3 px-3 py-3`}
      >
        <div className="min-w-56 flex-1">
          <StorageMeter usage={r.usage} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            render={<Link href={`/admin/members/${p.id}`} />}
            nativeButton={false}
          >
            Change limit
          </Button>
          {r.usage.quota !== null && (
            <form action={remindStorage.bind(null, p.id)}>
              <SubmitButton variant="outline">Remind member</SubmitButton>
            </form>
          )}
        </div>
      </div>
      <StorageReport report={r} base={base} readOnly />
    </AdminPage>
  )
}
