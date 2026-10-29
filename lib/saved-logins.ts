// "Save your login info" (Instagram-style one-tap sign-in). Relative imports:
// lib/auth.ts loads this, and the Better Auth CLI can't resolve `@/`.
import { randomBytes } from "node:crypto"

import { and, eq, inArray, lt } from "drizzle-orm"

import { db } from "./db"
import { account, savedLogins, user } from "./db/schema"
import {
  SAVED_MAX_AGE,
  hashSecret,
  mayUse,
  savedCookies,
  secretMatches,
  stillValid,
} from "./saved-login-rules"
import { getSettings } from "./signup"

export type SavedAccount = {
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  twoFactorEnabled: boolean
}

// The saved logins behind this browser's cookies that still work.
export async function savedOnBrowser(
  all: { name: string; value: string }[]
): Promise<SavedAccount[]> {
  const secrets = savedCookies(all)
  if (!secrets.size) return []
  const [rows, s] = await Promise.all([
    db
      .select({
        id: savedLogins.id,
        userId: savedLogins.userId,
        secretHash: savedLogins.secretHash,
        createdAt: savedLogins.createdAt,
        expiresAt: savedLogins.expiresAt,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
        // Any password change or reset updates the credential account.
        passwordAt: account.updatedAt,
      })
      .from(savedLogins)
      .innerJoin(user, eq(user.id, savedLogins.userId))
      .leftJoin(
        account,
        and(
          eq(account.userId, savedLogins.userId),
          eq(account.providerId, "credential")
        )
      )
      .where(inArray(savedLogins.id, [...secrets.keys()])),
    getSettings(),
  ])
  return rows
    .filter(
      (r) =>
        secretMatches(secrets.get(r.id)!, r.secretHash) &&
        stillValid(r, r.passwordAt) &&
        mayUse(r.role, s)
    )
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: r.email,
      image: r.image,
      twoFactorEnabled: Boolean(r.twoFactorEnabled),
    }))
}

export async function createSavedLogin(userId: string, ua: string | null) {
  const secret = randomBytes(32).toString("base64url")
  const [row] = await db
    .insert(savedLogins)
    .values({
      userId,
      secretHash: hashSecret(secret),
      ua,
      expiresAt: new Date(Date.now() + SAVED_MAX_AGE * 1000),
    })
    .returning({ id: savedLogins.id })
  return { id: row.id, secret }
}

// Each use pushes the 90 days out again.
export async function touchSavedLogin(id: string) {
  await db
    .update(savedLogins)
    .set({
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + SAVED_MAX_AGE * 1000),
    })
    .where(eq(savedLogins.id, id))
}

// Every browser forgets this account: password reset, admin action, "Sign out everywhere".
export async function forgetSavedLogins(userId: string) {
  await db.delete(savedLogins).where(eq(savedLogins.userId, userId))
}

export async function forgetSavedLogin(id: string) {
  await db.delete(savedLogins).where(eq(savedLogins.id, id))
}

export async function purgeSavedLogins() {
  await db.delete(savedLogins).where(lt(savedLogins.expiresAt, new Date()))
}
