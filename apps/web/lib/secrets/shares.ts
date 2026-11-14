// One-time share links. The text is sealed with the server key, only the token's
// hash is stored, and a link burns when its views run out, it expires or its
// owner revokes it. Anyone with the link can open it, account or not.
import "server-only"

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretShares } from "@/lib/db/schema"
import { shareMinutes } from "./gov-rules"
import { openServer, sealServer } from "./kms"
import { SecretsError, policy } from "./service"

export const SHARE_PREFIX = "ns_"
const MAX_FAILS = 10
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex")
const bad = (m: string, status = 400) => new SecretsError(status, m)
// The CLI passes its own (token name and IP); the web's comes from the session.
type Log = (action: string, detail: string) => Promise<unknown>
const sessionLog: Log = (action, detail) => audit(action, { detail })

async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  return `s1.${salt.toString("base64url")}.${(await scryptAsync(pw, salt, 32)).toString("base64url")}`
}
async function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split(".")
  const got = await scryptAsync(pw, Buffer.from(salt, "base64url"), 32)
  const want = Buffer.from(hash, "base64url")
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function createShare(
  userId: string,
  i: { text: string; minutes: unknown; maxViews: unknown; password?: string; label?: string },
  log = sessionLog
) {
  if (!(await policy()).sharesEnabled) throw bad("An admin turned share links off on this server.", 403)
  if (!i.text) throw bad("There's nothing to share.")
  if (i.text.length > 100_000) throw bad("That's too long to share (100,000 characters at most).")
  const mins = shareMinutes(i.minutes)
  if (!mins) throw bad("Pick an expiry between 1 hour and 30 days.")
  const views = Math.floor(Number(i.maxViews))
  if (!Number.isFinite(views) || views < 1 || views > 100) throw bad("Views can be 1 to 100.")
  const token = SHARE_PREFIX + randomBytes(24).toString("base64url")
  await db.insert(secretShares).values({
    tokenHash: hashToken(token),
    createdBy: userId,
    label: i.label?.trim().slice(0, 80) || null,
    valueEnc: sealServer(i.text),
    expiresAt: new Date(Date.now() + mins * 60_000),
    maxViews: views,
    passwordHash: i.password ? await hashPassword(i.password) : null,
  })
  await log("secrets_share_create", `${i.label?.trim() || "a text"}: ${views} view${views === 1 ? "" : "s"}, ${mins} minutes${i.password ? ", password" : ""}`)
  return token
}

type Row = typeof secretShares.$inferSelect
const stateOf = (r: Row) =>
  r.revokedAt ? "revoked" : r.views >= r.maxViews ? "viewed" : r.expiresAt <= new Date() ? "expired" : "active"

export async function listShares(userId: string) {
  const rows = await db
    .select()
    .from(secretShares)
    .where(eq(secretShares.createdBy, userId))
    .orderBy(desc(secretShares.createdAt))
    .limit(100)
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    state: stateOf(r),
    views: r.views,
    maxViews: r.maxViews,
    password: Boolean(r.passwordHash),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    firstViewedAt: r.firstViewedAt?.toISOString() ?? null,
  }))
}

export async function revokeShare(userId: string, id: string, log = sessionLog) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad("That link isn't here.", 404)
  const [r] = await db
    .update(secretShares)
    .set({ revokedAt: new Date(), valueEnc: null })
    .where(and(eq(secretShares.id, id), eq(secretShares.createdBy, userId), isNull(secretShares.revokedAt)))
    .returning({ label: secretShares.label })
  if (!r) throw bad("That link isn't here, or is already revoked.", 404)
  await log("secrets_share_revoke", r.label ?? "a text")
}

// What a visitor may know before clicking: whether it works and if it wants a password.
export async function shareMeta(token: string) {
  const [r] = token.startsWith(SHARE_PREFIX)
    ? await db.select().from(secretShares).where(eq(secretShares.tokenHash, hashToken(token)))
    : []
  if (!r || !(await policy()).sharesEnabled || stateOf(r) !== "active") return { ok: false as const }
  return {
    ok: true as const,
    label: r.label,
    password: Boolean(r.passwordHash),
    expiresAt: r.expiresAt.toISOString(),
    viewsLeft: r.maxViews - r.views,
  }
}

// Opens it: counts a view, hands over the text, and burns the link on its last view.
export async function revealShare(token: string, password: string) {
  const gone = { ok: false as const, error: "gone" as const }
  if (!token.startsWith(SHARE_PREFIX) || !(await policy()).sharesEnabled) return gone
  const hash = hashToken(token)
  const [r] = await db.select().from(secretShares).where(eq(secretShares.tokenHash, hash))
  if (!r || stateOf(r) !== "active" || !r.valueEnc) return gone
  if (r.passwordHash) {
    if (!password || !(await checkPassword(password, r.passwordHash))) {
      // Guessing burns the link after a few tries.
      const [f] = await db
        .update(secretShares)
        .set({ fails: sql`${secretShares.fails} + 1` })
        .where(eq(secretShares.id, r.id))
        .returning({ fails: secretShares.fails })
      if (f && f.fails >= MAX_FAILS)
        await db.update(secretShares).set({ revokedAt: new Date(), valueEnc: null }).where(eq(secretShares.id, r.id))
      return { ok: false as const, error: "password" as const }
    }
  }
  // The count moves in SQL so two visitors can't both take the last view.
  const [took] = await db
    .update(secretShares)
    .set({ views: sql`${secretShares.views} + 1`, firstViewedAt: sql`coalesce(${secretShares.firstViewedAt}, now())` })
    .where(
      and(
        eq(secretShares.id, r.id),
        sql`${secretShares.views} < ${secretShares.maxViews}`,
        isNull(secretShares.revokedAt),
        gt(secretShares.expiresAt, new Date())
      )
    )
    .returning({ views: secretShares.views, max: secretShares.maxViews })
  if (!took) return gone
  const text = openServer(r.valueEnc)
  if (took.views >= took.max) await db.update(secretShares).set({ valueEnc: null }).where(eq(secretShares.id, r.id))
  return { ok: true as const, text, viewsLeft: took.max - took.views }
}
