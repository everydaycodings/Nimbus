"use server"

import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  ADDING_COOKIE,
  KNOWN_COOKIE,
  KNOWN_COOKIE_OPTIONS,
  parseKnown,
} from "@/lib/accounts"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { session } from "@/lib/db/schema"
import {
  deviceAccounts,
  deviceToken,
  getSession,
  logAuthEvent,
} from "@/lib/session"
import {
  OFFER_SAVE_COOKIE,
  SAVED_MAX_AGE,
  SAVED_PREFIX,
  mayUse,
} from "@/lib/saved-login-rules"
import {
  createSavedLogin,
  forgetSavedLogin,
  forgetSavedLogins,
  savedOnBrowser,
} from "@/lib/saved-logins"
import { getSettings } from "@/lib/signup"

async function forget(userId: string) {
  const jar = await cookies()
  const known = parseKnown(jar.get(KNOWN_COOKIE)?.value)
  jar.set(
    KNOWN_COOKIE,
    JSON.stringify(known.filter((k) => k.id !== userId)),
    KNOWN_COOKIE_OPTIONS
  )
}

// Signs out the account in use; the next one on this browser takes over.
// The client reloads afterwards.
export async function signOutCurrent() {
  const current = await getSession()
  if (!current) return
  await logAuthEvent(current.user.id, "signed_out")
  await auth.api.revokeDeviceSession({
    headers: await headers(),
    body: { sessionToken: current.session.token },
  })
  await forget(current.user.id)
}

// For the full-screen status pages, which have no client state to clear.
export async function signOut() {
  await signOutCurrent()
  redirect("/")
}

// The × on another account's row in the menu.
export async function signOutAccount(userId: string) {
  const token = await deviceToken(userId)
  if (token) {
    await logAuthEvent(userId, "signed_out")
    await auth.api.revokeDeviceSession({
      headers: await headers(),
      body: { sessionToken: token },
    })
  }
  await forget(userId)
  revalidatePath("/", "layout")
}

// The multi-session plugin ends every account on this browser on /sign-out.
export async function signOutAll() {
  for (const a of await deviceAccounts())
    if (a.live) await logAuthEvent(a.id, "signed_out")
  await auth.api.signOut({ headers: await headers() })
  ;(await cookies()).delete(KNOWN_COOKIE)
}

// Ends my sessions on every device, then moves this browser to my next account.
export async function signOutEverywhere() {
  const current = await getSession()
  if (!current) return
  await signOutCurrent()
  await forgetSavedLogins(current.user.id)
  await db
    .delete(session)
    .where(
      and(
        eq(session.userId, current.user.id),
        ne(session.token, current.session.token)
      )
    )
}

export async function switchAccount(userId: string) {
  const token = await deviceToken(userId)
  if (!token) return false
  ;(await cookies()).delete(ADDING_COOKIE)
  await auth.api.setActiveSession({
    headers: await headers(),
    body: { sessionToken: token },
  })
  await logAuthEvent(userId, "switched")
  return true
}

// Opens sign-in on top of the current account, within the admin's limit.
export async function startAddAccount(): Promise<{ error?: string }> {
  const { multiAccount, maxAccounts } = await getSettings()
  if (!multiAccount)
    return { error: "Your admin turned off signing in to several accounts." }
  const live = (await deviceAccounts()).filter((a) => a.live).length
  if (live >= maxAccounts)
    return {
      error: `You can be signed in to ${maxAccounts} accounts at once. Sign out of one first.`,
    }
  await auth.api.keepCurrentSession({ headers: await headers() })
  ;(await cookies()).set(ADDING_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  })
  return {}
}

// Back from the add-account sign-in. A pending two-factor step has already
// dropped the active session, so the first account on this browser takes over.
export async function cancelAddAccount() {
  ;(await cookies()).delete(ADDING_COOKIE)
  if (!(await getSession())) {
    const next = (await deviceAccounts()).find((a) => a.live)
    const token = next && (await deviceToken(next.id))
    if (token)
      await auth.api.setActiveSession({
        headers: await headers(),
        body: { sessionToken: token },
      })
  }
  redirect("/")
}

// "Save your login info?" after a fresh sign-in (see the app layout).
export async function saveLogin() {
  const current = await getSession()
  const jar = await cookies()
  jar.delete(OFFER_SAVE_COOKIE)
  if (!current || !mayUse(current.user.role, await getSettings())) return
  const { id, secret } = await createSavedLogin(
    current.user.id,
    (await headers()).get("user-agent")
  )
  jar.set(SAVED_PREFIX + id, secret, {
    ...KNOWN_COOKIE_OPTIONS,
    maxAge: SAVED_MAX_AGE,
  })
  revalidatePath("/", "layout")
}

export async function dismissSaveLogin() {
  ;(await cookies()).delete(OFFER_SAVE_COOKIE)
  revalidatePath("/", "layout")
}

// One tap on the sign-in page. Two-factor accounts continue on /two-factor.
export async function signInSaved(
  id: string
): Promise<{ twoFactor?: boolean; error?: string }> {
  try {
    const r = await auth.api.signInSaved({
      headers: await headers(),
      body: { id },
    })
    return { twoFactor: r.twoFactorRedirect }
  } catch (e) {
    return {
      error:
        (e as { body?: { message?: string } }).body?.message ??
        "Couldn't sign you in. Try your password.",
    }
  }
}

// Forgets a saved login on this browser only.
export async function forgetSaved(id: string) {
  const jar = await cookies()
  const [saved] = await savedOnBrowser(jar.getAll()).then((all) =>
    all.filter((a) => a.id === id)
  )
  if (saved) await forgetSavedLogin(id)
  jar.delete(SAVED_PREFIX + id)
  revalidatePath("/", "layout")
}
