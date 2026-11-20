import { notFound } from "next/navigation"

import { allowed } from "@/lib/server-backup/access"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Server backup · Nimbus" }
export const dynamic = "force-dynamic"

// 404 while an admin has the tool off, or has limited it to admins and this isn't one.
export default async function ServerBackupLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember()
  if (!allowed(await getSettings(), me.role)) notFound()
  return children
}
