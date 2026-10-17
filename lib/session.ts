import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { and, eq } from "drizzle-orm"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { account, type Role, type Status } from "@/lib/db/schema"

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

// Guard for file actions, which skip the layout's gates: signed in, approved,
// and not still on a temporary password.
export async function requireMember() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  if (session.user.status !== "active" || session.user.passwordTemporary)
    redirect("/")
  return session.user
}

// Two-factor and password changes only apply to accounts that sign in with a password.
export async function hasPassword(userId: string) {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential"))
    )
  return Boolean(row)
}
