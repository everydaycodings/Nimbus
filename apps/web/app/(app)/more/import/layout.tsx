import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Cloud import · Nimbus" }
export const dynamic = "force-dynamic"

export default async function ImportLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  if (!(await getSettings()).importToolEnabled) notFound()
  return children
}
