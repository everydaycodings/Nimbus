import { notFound } from "next/navigation"

import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Registry tools · Nimbus" }
export const dynamic = "force-dynamic"

export default async function RegistryToolsLayout({ children }: { children: React.ReactNode }) {
  await requireMember()
  const s = await getSettings()
  if (!s.registryToolsEnabled || !s.registry) notFound()
  return children
}
