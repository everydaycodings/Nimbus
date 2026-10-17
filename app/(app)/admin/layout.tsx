import { requireAdmin } from "@/lib/session"
import { AdminNav } from "./admin-nav"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAdmin()
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage who can use this Nimbus, how new people get in, and how it
          reaches them.
        </p>
      </div>
      <AdminNav />
      {children}
    </div>
  )
}
