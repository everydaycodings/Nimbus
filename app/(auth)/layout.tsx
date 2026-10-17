import { CloudIcon } from "@phosphor-icons/react/dist/ssr"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/session"

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (await getSession()) redirect("/")
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-medium">
          <span className="grid size-7 place-items-center rounded-md bg-muted">
            <CloudIcon weight="fill" className="size-4.5 text-brand" />
          </span>
          Nimbus
        </div>
        {children}
      </div>
    </main>
  )
}
