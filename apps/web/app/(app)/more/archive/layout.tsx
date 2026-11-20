import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Website archive · Nimbus" }
export const dynamic = "force-dynamic"

export default async function ArchiveLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  if (!(await getSettings()).archiverToolEnabled) notFound()
  return children
}
