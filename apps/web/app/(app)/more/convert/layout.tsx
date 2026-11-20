import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Media converter · Nimbus" }
export const dynamic = "force-dynamic"

export default async function ConvertLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  if (!(await getSettings()).convertToolEnabled) notFound()
  return children
}
