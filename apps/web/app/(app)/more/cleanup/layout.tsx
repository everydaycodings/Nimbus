import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Clean up · Nimbus" }
export const dynamic = "force-dynamic"

export default async function CleanupLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  if (!(await getSettings()).cleanupToolEnabled) notFound()
  return children
}
