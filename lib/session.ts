import "server-only"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { KNOWN_COOKIE, parseKnown } from "@/lib/accounts"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  account,
  authEvents,
  notifications,
  type AuthEventKind,
  type Role,
  type Status,
} from "@/lib/db/schema"
import { clientIp } from "@/lib/links"
import { savedOnBrowser } from "@/lib/saved-logins"

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

// requireMember() for route handlers, which answer 401 instead of redirecting.
export async function memberOrNull() {
  const session = await getSession()
  if (
    !session ||
    session.user.status !== "active" ||
    session.user.passwordTemporary
  )
    return null
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

export type DeviceAccount = {
  id: string
  name: string
  email: string
  image: string | null
  // Signed in now; false means the session ran out ("Sign in again").
  live: boolean
  status: Status
  passwordTemporary: boolean
  unread: number
  // Login info saved on this browser (one tap on the sign-in page).
  savedId: string | null
}

// Every account signed in on this browser, in the order they were first added.
// Session tokens stay on the server.
export const deviceAccounts = cache(async (): Promise<DeviceAccount[]> => {
  const sessions = await auth.api.listDeviceSessions({
    headers: await headers(),
  })
  const live = new Map(sessions.map((s) => [s.user.id, s.user]))
  const counts = live.size
    ? await db
        .select({
          id: notifications.userId,
          n: sql<number>`count(*)::int`,
        })
        .from(notifications)
        .where(
          and(
            inArray(notifications.userId, [...live.keys()]),
            isNull(notifications.readAt)
          )
        )
        .groupBy(notifications.userId)
    : []
  const unread = new Map(counts.map((c) => [c.id, c.n]))

  const jar = await cookies()
  const known = parseKnown(jar.get(KNOWN_COOKIE)?.value)
  const saved = new Map(
    (await savedOnBrowser(jar.getAll())).map((a) => [a.userId, a.id])
  )
  const ids = [
    ...known.map((k) => k.id),
    ...[...live.keys()].filter((id) => !known.some((k) => k.id === id)),
  ]
  return ids.map((id) => {
    const u = live.get(id) as
      | ((typeof sessions)[number]["user"] & {
          status: Status
          passwordTemporary: boolean
        })
      | undefined
    const k = known.find((k) => k.id === id)!
    return {
      id,
      name: u?.name ?? k.name,
      email: u?.email ?? k.email,
      image: u?.image ?? k.image,
      live: Boolean(u),
      status: u?.status ?? "active",
      passwordTemporary: Boolean(u?.passwordTemporary),
      unread: unread.get(id) ?? 0,
      savedId: saved.get(id) ?? null,
    }
  })
})

// The session token for one of this browser's accounts.
export async function deviceToken(userId: string) {
  const sessions = await auth.api.listDeviceSessions({
    headers: await headers(),
  })
  return sessions.find((s) => s.user.id === userId)?.session.token
}

export async function logAuthEvent(userId: string, kind: AuthEventKind) {
  const h = await headers()
  await db.insert(authEvents).values({
    userId,
    kind,
    ip: await clientIp(),
    ua: h.get("user-agent"),
  })
}
