import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { auth } from "@/lib/auth"
import type { Role, Status } from "@/lib/db/schema"

export const getSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const user = session.user as typeof session.user & {
    role: Role
    status: Status
  }
  return { ...session, user }
})

export const isAdmin = (role: Role) => role === "owner" || role === "admin"

// Guard for admin-only pages and actions. Re-checks the database on every call,
// so a demoted or rejected admin loses access immediately.
export async function requireAdmin() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  if (session.user.status !== "active" || !isAdmin(session.user.role))
    redirect("/")
  return session.user
}
