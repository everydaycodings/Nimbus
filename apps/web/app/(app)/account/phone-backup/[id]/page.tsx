import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PhoneBackupView } from "@/components/phone-backup-view"
import { UUID } from "@/lib/file-rules"
import { listPhones } from "@/lib/services/phone-backup"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Phone backup · Nimbus" }

export default async function PhoneBackupPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const device = (await listPhones(me)).find((d) => d.id === id)
  if (!device) notFound()
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/account#phone-backup"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" /> Account
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{device.deviceName}</h1>
        <p className="text-sm text-muted-foreground">
          Contacts and calendar this phone backed up. They&apos;re read in your browser; nothing leaves it.
        </p>
      </div>
      <PhoneBackupView device={device} />
    </div>
  )
}
