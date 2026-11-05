// Signing in a phone from a browser that's already signed in. The browser shows
// a one-time QR and short code; the device claims it and waits; the browser
// approves; the device collects a session once. Only hashes are stored.
// Relative imports: lib/auth.ts loads this, and the Better Auth CLI can't resolve `@/`.
import { randomBytes } from "node:crypto"

import { and, eq, gt, lt, or } from "drizzle-orm"

import { db } from "./db"
import { deviceLinks } from "./db/schema"
import {
  APPROVED_TTL_MS,
  LINK_TTL_MS,
  hashSecret,
  newCode,
  newToken,
  normalizeCode,
} from "./device-link-rules"

export async function startLink(userId: string) {
  // One live link per person, and old rows don't pile up.
  await db
    .delete(deviceLinks)
    .where(
      or(eq(deviceLinks.userId, userId), lt(deviceLinks.expiresAt, new Date()))
    )
  const token = newToken()
  const code = newCode()
  const expiresAt = new Date(Date.now() + LINK_TTL_MS)
  const [row] = await db
    .insert(deviceLinks)
    .values({
      userId,
      tokenHash: hashSecret(token),
      codeHash: hashSecret(code),
      expiresAt,
    })
    .returning({ id: deviceLinks.id })
  return { id: row.id, token, code, expiresAt }
}

export async function linkState(userId: string, id: string) {
  const [row] = await db
    .select({
      status: deviceLinks.status,
      deviceName: deviceLinks.deviceName,
      ip: deviceLinks.ip,
      expiresAt: deviceLinks.expiresAt,
    })
    .from(deviceLinks)
    .where(and(eq(deviceLinks.id, id), eq(deviceLinks.userId, userId)))
  if (!row) return null
  const expired = row.expiresAt.getTime() < Date.now() && row.status !== "used"
  return { ...row, status: expired ? ("expired" as const) : row.status }
}

export async function answerLink(userId: string, id: string, allow: boolean) {
  const [row] = await db
    .update(deviceLinks)
    .set(
      allow
        ? {
            status: "approved",
            expiresAt: new Date(Date.now() + APPROVED_TTL_MS),
          }
        : { status: "denied" }
    )
    .where(
      and(
        eq(deviceLinks.id, id),
        eq(deviceLinks.userId, userId),
        eq(deviceLinks.status, "pending-approval"),
        gt(deviceLinks.expiresAt, new Date())
      )
    )
    .returning({ id: deviceLinks.id })
  return Boolean(row)
}

// A device presents the QR token or short code. Works once: the update only
// matches an unclaimed link, so a second device can't take it over.
export async function claimLink(
  secret: { token?: string; code?: string },
  deviceName: string,
  ip: string | null
) {
  const code = secret.code ? normalizeCode(secret.code) : null
  const match = secret.token
    ? eq(deviceLinks.tokenHash, hashSecret(secret.token))
    : code
      ? eq(deviceLinks.codeHash, hashSecret(code))
      : null
  if (!match) return null
  const pollSecret = randomBytes(32).toString("base64url")
  const [row] = await db
    .update(deviceLinks)
    .set({
      status: "pending-approval",
      deviceName: deviceName.slice(0, 80),
      ip: ip?.replace(/^::ffff:/, "") ?? null,
      pollHash: hashSecret(pollSecret),
    })
    .where(
      and(
        match,
        eq(deviceLinks.status, "waiting"),
        gt(deviceLinks.expiresAt, new Date())
      )
    )
    .returning({ id: deviceLinks.id })
  return row ? pollSecret : null
}

export async function pollLink(pollSecret: string) {
  const [row] = await db
    .select({ status: deviceLinks.status, expiresAt: deviceLinks.expiresAt })
    .from(deviceLinks)
    .where(eq(deviceLinks.pollHash, hashSecret(pollSecret)))
  if (!row || row.expiresAt.getTime() < Date.now()) return "expired" as const
  return row.status
}

// Hands over the approved link once, and says whose session to start.
export async function collectLink(pollSecret: string) {
  const [row] = await db
    .update(deviceLinks)
    .set({ status: "used" })
    .where(
      and(
        eq(deviceLinks.pollHash, hashSecret(pollSecret)),
        eq(deviceLinks.status, "approved"),
        gt(deviceLinks.expiresAt, new Date())
      )
    )
    .returning({ userId: deviceLinks.userId })
  return row?.userId ?? null
}
