import { HashFlash } from "@/components/admin/setting-client"
import { requireAdmin } from "@/lib/session"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAdmin()
  return (
    <>
      <HashFlash />
      {children}
    </>
  )
}
