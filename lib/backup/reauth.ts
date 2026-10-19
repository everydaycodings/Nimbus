// Proving it's really the admin before a sensitive backup action (download,
// storage keys). Unlocks this session for 10 minutes. How:
//
// - Email is set up: password accounts type their password; Google/GitHub-only
//   accounts get a 6-digit code by email.
// - No email: an authenticator code (2FA), which then has to be on.
import "server-only"

import { createHmac, randomInt, timingSafeEqual } from "node:crypto"

import { createOTP } from "@better-auth/utils/otp"
import { symmetricDecrypt } from "better-auth/crypto"
import { and, eq, lt, sql } from "drizzle-orm"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { backupReauth, twoFactor } from "@/lib/db/schema"
import { emailEnabled, message, sendInBackground } from "@/lib/email"
import { getSession, hasPassword } from "@/lib/session"

const UNLOCK_MS = 10 * 60_000
const CODE_MS = 10 * 60_000
const MAX_TRIES = 5

export type Method = "password" | "email" | "totp" | "none"

// How this admin proves it, or "none" when they can't yet (no email, no 2FA).
export async function reauthMethod(user: {
  id: string
  twoFactorEnabled?: boolean | null
}): Promise<Method> {
  if (!(await emailEnabled())) return user.twoFactorEnabled ? "totp" : "none"
  return (await hasPassword(user.id)) ? "password" : "email"
}

async function current() {
  const s = await getSession()
  if (!s) throw new Error("Not signed in.")
  return s
}

export async function isUnlocked() {
  const s = await current()
  const [row] = await db
    .select({ until: backupReauth.verifiedUntil })
    .from(backupReauth)
    .where(eq(backupReauth.sessionId, s.session.id))
  return Boolean(row?.until && row.until > new Date())
}

// For server actions: throws unless this session proved itself recently.
export async function requireUnlocked() {
  if (!(await isUnlocked()))
    throw new Error("Confirm it's you first. This unlocks for 10 minutes.")
}

const hash = (code: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(`backup-reauth:${code}`)
    .digest("hex")

async function unlock(sessionId: string) {
  const row = { verifiedUntil: new Date(Date.now() + UNLOCK_MS), codeHash: null, attempts: 0 }
  await db
    .insert(backupReauth)
    .values({ sessionId, ...row })
    .onConflictDoUpdate({ target: backupReauth.sessionId, set: row })
}

// Emails a code; at most one a minute.
export async function sendCode() {
  const s = await current()
  if ((await reauthMethod(s.user)) !== "email") return "Codes are only for accounts without a password."
  const [row] = await db
    .select({ sent: backupReauth.codeSentAt })
    .from(backupReauth)
    .where(eq(backupReauth.sessionId, s.session.id))
  if (row?.sent && Date.now() - row.sent.getTime() < 60_000)
    return "A code was just sent. Wait a minute before asking for another."
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const now = new Date()
  const set = {
    codeHash: hash(code),
    codeExpiresAt: new Date(now.getTime() + CODE_MS),
    codeSentAt: now,
    attempts: 0,
  }
  await db
    .insert(backupReauth)
    .values({ sessionId: s.session.id, ...set })
    .onConflictDoUpdate({ target: backupReauth.sessionId, set })
  sendInBackground(
    message({
      to: s.user.email,
      subject: `${code} is your Nimbus confirmation code`,
      lines: [
        `Use ${code} to confirm it's you in Admin → Backups. It works for 10 minutes.`,
        "If you didn't ask for this, someone may be using your admin session: sign out everywhere from Account.",
      ],
    })
  )
  return null
}

async function checkTotp(userId: string, code: string) {
  const [row] = await db
    .select({ secret: twoFactor.secret })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
  if (!row) return false
  const ctx = await auth.$context
  const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: row.secret })
  return createOTP(secret, { digits: 6, period: 30 }).verify(code)
}

// Checks the password or code. Returns an error to show, or null when unlocked.
export async function verify(input: string) {
  const s = await current()
  const method = await reauthMethod(s.user)
  const value = input.trim()
  if (!value) return "Enter it first."

  if (method === "password") {
    const ok = await auth.api
      .verifyPassword({ body: { password: value }, headers: await headers() })
      .then(() => true)
      .catch(() => false)
    if (!ok) return "That password isn't right."
  } else if (method === "totp") {
    if (!(await checkTotp(s.user.id, value.replace(/\s/g, ""))))
      return "That code isn't right, or it expired. Codes change every 30 seconds."
  } else if (method === "email") {
    const [row] = await db
      .select()
      .from(backupReauth)
      .where(eq(backupReauth.sessionId, s.session.id))
    if (!row?.codeHash || !row.codeExpiresAt || row.codeExpiresAt < new Date())
      return "That code expired. Send a new one."
    // Counted atomically, so parallel guesses can't get past the limit.
    const [spent] = await db
      .update(backupReauth)
      .set({ attempts: sql`${backupReauth.attempts} + 1` })
      .where(and(eq(backupReauth.sessionId, s.session.id), lt(backupReauth.attempts, MAX_TRIES)))
      .returning({ n: backupReauth.attempts })
    if (!spent) return "Too many tries. Send a new code."
    const a = Buffer.from(hash(value.replace(/\s/g, "")))
    const b = Buffer.from(row.codeHash)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return "That code isn't right."
  } else {
    return "Set up email or two-factor first."
  }
  await unlock(s.session.id)
  return null
}
