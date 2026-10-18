// Relative imports: lib/auth.ts imports this and the Better Auth CLI can't resolve `@/`.
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm"

import { db } from "./db"
import { invites, settings, shares } from "./db/schema"
import { readToken } from "./upload-rules"

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

// Set by /invite/share/[token]: someone shared files with this email address.
export const SHARE_INVITE_COOKIE = "nimbus_share_invite"

// The invited email, if the emailed token is genuine and its invite is still
// waiting. Opening the link proves the inbox is theirs.
export async function readShareInvite(token: string | undefined | null) {
  const t = readToken<{ s: string; e: string; exp: number }>(
    "share-invite",
    token
  )
  if (!t || t.exp < Date.now()) return null
  const [row] = await db
    .select({ email: shares.granteeEmail })
    .from(shares)
    .where(
      and(
        eq(shares.id, t.s),
        isNotNull(shares.granteeEmail),
        sql`lower(${shares.granteeEmail}) = lower(${t.e})`
      )
    )
  return row?.email ?? null
}

// Turns every invite for this email into a share for the new account. Where
// they already have a share on the same item, the invite just goes away.
export async function bindShareInvites(userId: string, email: string) {
  const mine = sql`lower(${shares.granteeEmail}) = lower(${email})`
  await db.delete(shares).where(
    and(
      mine,
      sql`exists (select 1 from shares s2 where s2.node_id = ${shares.nodeId}
        and s2.grantee_id = ${userId})`
    )
  )
  return db
    .update(shares)
    .set({ granteeId: userId, granteeEmail: null })
    .where(mine)
    .returning({
      nodeId: shares.nodeId,
      createdBy: shares.createdBy,
      role: shares.role,
    })
}
