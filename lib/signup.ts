// Relative imports: lib/auth.ts imports this and the Better Auth CLI can't resolve `@/`.
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm"

import { db } from "./db"
import { invites, settings } from "./db/schema"

// Set by /invite/[token] and read when the account is created.
export const INVITE_COOKIE = "nimbus_invite"

// The row is seeded by the migration that created the table.
export async function getSettings() {
  const [row] = await db.select().from(settings)
  return row
}

const usable = and(
  or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`now()`)),
  or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses))
)

export async function findInvite(token: string) {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.token, token), usable))
  return row ?? null
}

// Spends one use atomically, so a 1-use link can't be redeemed twice in a race.
// ponytail: the use is spent before the user row is inserted; a failed insert burns it.
export async function claimInvite(token: string) {
  const [row] = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(and(eq(invites.token, token), usable))
    .returning({ id: invites.id })
  return row ?? null
}

export function isTrustedEmail(email: string, domains: string[]) {
  const domain = email.split("@").pop()?.toLowerCase()
  return Boolean(domain && domains.includes(domain))
}
