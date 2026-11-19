import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Git Backup · Nimbus" }
export const dynamic = "force-dynamic"

export default async function GitBackupLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  if (!(await getSettings()).gitBackupEnabled) notFound()
  return children
}
