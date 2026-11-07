import { notFound } from "next/navigation"

import { TransferList } from "@/components/transfer-list"
import { appUrl } from "@/lib/email"
import * as svc from "@/lib/services/transfers"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Transfers · Nimbus" }

export default async function TransfersPage() {
  const me = await requireMember()
  const options = await svc.transferOptions()
  if (!options.enabled) notFound()
  return (
    <TransferList
      transfers={await svc.listTransfers(me)}
      options={options}
      base={appUrl()}
      tusUrl={process.env.TUS_URL ?? ""}
    />
  )
}
