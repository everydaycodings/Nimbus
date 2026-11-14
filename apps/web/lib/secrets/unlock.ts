// The Secrets unlock: a row per signed-in session (secret_unlocks) that every
// Secrets request checks and slides forward. Dead after the member's idle
// minutes, or 12 hours after it was opened, whatever the browser says.
// Proving it's you: password, passkey, authenticator code or a Secrets PIN.
import "server-only"

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import { and, eq, sql } from "drizzle-orm"
import { headers } from "next/headers"

import { auth, passkeyOrigins, passkeyStatus } from "@/lib/auth"
import { checkTotp } from "@/lib/backup/reauth"
import { db } from "@/lib/db"
import { passkey, secretSettings, secretUnlocks, settings } from "@/lib/db/schema"
import { passkeyHost } from "@/lib/passkey-rules"
import { getSession, hasPassword } from "@/lib/session"

export const LOCK_CHOICES = [5, 15, 30, 60] as const
const MAX_AGE_HOURS = 12
const MAX_FAILS = 5
const LOCKOUT_MS = 5 * 60_000
const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number
) => Promise<Buffer>

export type Method = "password" | "passkey" | "totp" | "pin"

// Admin → Secrets: the longest idle time a member may pick, and how long one unlock lives.
export async function unlockPolicy() {
  const [row] = await db
    .select({ idle: settings.secretMaxIdleMinutes, hours: settings.secretUnlockMaxHours })
    .from(settings)
  return { maxIdle: row?.idle ?? null, maxAgeMs: (row?.hours ?? MAX_AGE_HOURS) * 3600_000 }
}

async function prefs(userId: string) {
  await db.insert(secretSettings).values({ userId }).onConflictDoNothing()
  const [row] = await db
    .select()
    .from(secretSettings)
    .where(eq(secretSettings.userId, userId))
  return row
}

export async function methodsFor(user: {
  id: string
  twoFactorEnabled?: boolean | null
}) {
  const p = await prefs(user.id)
  const methods: Method[] = []
  if (await hasPassword(user.id)) methods.push("password")
  if ((await passkeyStatus()).available) {
    const [k] = await db
      .select({ id: passkey.id })
      .from(passkey)
      .where(eq(passkey.userId, user.id))
      .limit(1)
    if (k) methods.push("passkey")
  }
  if (user.twoFactorEnabled) methods.push("totp")
  if (p.pinHash) methods.push("pin")
  const { maxIdle } = await unlockPolicy()
  return {
    methods,
    lockMinutes: maxIdle ? Math.min(p.lockMinutes, maxIdle) : p.lockMinutes,
    hasPin: Boolean(p.pinHash),
  }
}

// The state for the signed-in session, and slides the idle clock when `touch`.
export async function unlockState(touch = true) {
  const s = await getSession()
  if (!s) return null
  const p = await prefs(s.user.id)
  const { maxIdle, maxAgeMs } = await unlockPolicy()
  const lockMinutes = maxIdle ? Math.min(p.lockMinutes, maxIdle) : p.lockMinutes
  const [row] = await db
    .select()
    .from(secretUnlocks)
    .where(eq(secretUnlocks.sessionId, s.session.id))
  const now = Date.now()
  const live =
    row?.unlockedAt &&
    row.lastActiveAt &&
    row.userId === s.user.id &&
    now - row.unlockedAt.getTime() < maxAgeMs &&
    now - row.lastActiveAt.getTime() < lockMinutes * 60_000
  if (live && touch)
    await db
      .update(secretUnlocks)
      .set({ lastActiveAt: new Date() })
      .where(eq(secretUnlocks.sessionId, s.session.id))
  return {
    sessionId: s.session.id,
    userId: s.user.id,
    unlocked: Boolean(live),
    lockMinutes,
  }
}

// Locks every session of the member, so a CLI signed in as them is locked too.
export async function lock() {
  const s = await getSession()
  if (s)
    await db
      .update(secretUnlocks)
      .set({ unlockedAt: null, lastActiveAt: null, challenge: null })
      .where(eq(secretUnlocks.userId, s.user.id))
}

async function open(sessionId: string, userId: string) {
  const now = new Date()
  const v = { userId, unlockedAt: now, lastActiveAt: now, challenge: null }
  await db
    .insert(secretUnlocks)
    .values({ sessionId, ...v })
    .onConflictDoUpdate({ target: secretUnlocks.sessionId, set: v })
  await db
    .update(secretSettings)
    .set({ fails: 0, lockedUntil: null })
    .where(eq(secretSettings.userId, userId))
}

// Takes one try before checking anything, in SQL, so parallel guesses can't all slip in
// before the count moves. Null while locked out. The try that reaches MAX_FAILS starts
// the lockout; a right answer clears it again (open()).
async function claimTry(userId: string) {
  const expired = sql`${secretSettings.lockedUntil} is not null and ${secretSettings.lockedUntil} <= now()`
  const [r] = await db
    .update(secretSettings)
    .set({
      fails: sql`case when ${expired} then 1 else ${secretSettings.fails} + 1 end`,
      lockedUntil: sql`case when (case when ${expired} then 1 else ${secretSettings.fails} + 1 end) >= ${MAX_FAILS} then now() + ${`${LOCKOUT_MS / 1000} seconds`}::interval else null end`,
    })
    .where(and(eq(secretSettings.userId, userId), sql`(${secretSettings.lockedUntil} is null or ${secretSettings.lockedUntil} <= now())`))
    .returning({ fails: secretSettings.fails })
  return r ?? null
}

const hashPin = async (pin: string) => {
  const salt = randomBytes(16)
  return `s1.${salt.toString("base64url")}.${(await scryptAsync(pin, salt, 32)).toString("base64url")}`
}

async function pinOk(stored: string, pin: string) {
  const [v, salt, hash] = stored.split(".")
  if (v !== "s1" || !salt || !hash) return false
  const got = await scryptAsync(pin, Buffer.from(salt, "base64url"), 32)
  const want = Buffer.from(hash, "base64url")
  return got.length === want.length && timingSafeEqual(got, want)
}

export const PIN_HINT = "A PIN is 6 to 32 characters."
export const validPin = (pin: string) => pin.length >= 6 && pin.length <= 32

// Asks the browser for a passkey: options for startAuthentication().
export async function passkeyOptions() {
  const st = await unlockState(false)
  const rpID = passkeyHost(process.env.BETTER_AUTH_URL)
  if (!st || !rpID) return null
  const keys = await db
    .select()
    .from(passkey)
    .where(eq(passkey.userId, st.userId))
  if (!keys.length) return null
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: keys.map((k) => ({
      id: k.credentialID,
      transports: k.transports?.split(",").filter(Boolean) as
        | undefined
        | AuthenticatorTransport[],
    })),
  })
  const v = {
    userId: st.userId,
    challenge: options.challenge,
    challengeExpiresAt: new Date(Date.now() + 5 * 60_000),
  }
  await db
    .insert(secretUnlocks)
    .values({ sessionId: st.sessionId, ...v })
    .onConflictDoUpdate({ target: secretUnlocks.sessionId, set: v })
  return options
}

async function checkPasskey(sessionId: string, userId: string, resp: unknown) {
  const rpID = passkeyHost(process.env.BETTER_AUTH_URL)
  const r = resp as { id?: string } | null
  if (!rpID || !r?.id) return false
  const [row] = await db
    .select()
    .from(secretUnlocks)
    .where(eq(secretUnlocks.sessionId, sessionId))
  // One try per challenge: whoever clears it first gets to use it.
  const [spent] = row?.challenge
    ? await db
        .update(secretUnlocks)
        .set({ challenge: null })
        .where(
          and(
            eq(secretUnlocks.sessionId, sessionId),
            eq(secretUnlocks.challenge, row.challenge)
          )
        )
        .returning({ id: secretUnlocks.sessionId })
    : []
  const [key] = await db
    .select()
    .from(passkey)
    .where(and(eq(passkey.credentialID, r.id), eq(passkey.userId, userId)))
  if (!spent || !row?.challengeExpiresAt || row.challengeExpiresAt < new Date() || !key)
    return false
  try {
    const v = await verifyAuthenticationResponse({
      response: resp as never,
      expectedChallenge: row.challenge!,
      expectedOrigin: passkeyOrigins(),
      expectedRPID: rpID,
      credential: {
        id: key.credentialID,
        publicKey: Buffer.from(key.publicKey, "base64"),
        counter: key.counter,
        transports: key.transports?.split(",").filter(Boolean) as
          | undefined
          | AuthenticatorTransport[],
      },
      requireUserVerification: false,
    })
    if (!v.verified) return false
    await db
      .update(passkey)
      .set({ counter: v.authenticationInfo.newCounter })
      .where(eq(passkey.id, key.id))
    return true
  } catch {
    return false
  }
}

// An error to show, or null once unlocked. `input` is a password, code or PIN,
// or the browser's passkey response.
export async function unlockWith(method: Method, input: unknown) {
  const s = await getSession()
  if (!s) return "Sign in first."
  const p = await prefs(s.user.id)
  const { methods } = await methodsFor(s.user)
  if (!methods.includes(method)) return "That way of unlocking isn't available."
  const text = typeof input === "string" ? input.trim() : ""
  if (method !== "passkey" && !text) return "Enter it first."
  const tried = await claimTry(s.user.id)
  if (!tried) return "Too many wrong tries. Wait a few minutes and try again."

  let ok = false
  let wrong = "That isn't right."
  if (method === "password") {
    ok = await auth.api
      .verifyPassword({ body: { password: String(input) }, headers: await headers() })
      .then(() => true)
      .catch(() => false)
    wrong = "That password isn't right."
  } else if (method === "totp") {
    ok = await checkTotp(s.user.id, text.replace(/\s/g, ""))
    wrong = "That code isn't right, or it expired."
  } else if (method === "pin") {
    ok = Boolean(p.pinHash) && (await pinOk(p.pinHash!, String(input)))
    wrong = "That PIN isn't right."
  } else {
    ok = await checkPasskey(s.session.id, s.user.id, input)
    wrong = "That passkey didn't work."
  }
  if (!ok) return tried.fails >= MAX_FAILS ? "Too many wrong tries. Wait 5 minutes and try again." : wrong
  await open(s.session.id, s.user.id)
  return null
}

// Members with no password, passkey or authenticator can't prove anything, so
// their first PIN also unlocks. Everyone else sets or changes it while unlocked.
export async function setPin(pin: string | null) {
  const st = await unlockState()
  const s = await getSession()
  if (!st || !s) return "Sign in first."
  const { methods } = await methodsFor(s.user)
  const bootstrap = !methods.length && pin !== null
  if (!st.unlocked && !bootstrap) return "Unlock first."
  if (pin !== null && !validPin(pin)) return PIN_HINT
  if (pin === null && methods.length === 1 && methods[0] === "pin")
    return "Your PIN is the only way you can unlock. Add a passkey or two-factor first."
  await prefs(st.userId)
  await db
    .update(secretSettings)
    .set({ pinHash: pin === null ? null : await hashPin(pin) })
    .where(eq(secretSettings.userId, st.userId))
  if (bootstrap) await open(st.sessionId, st.userId)
  return null
}

export async function setLockMinutes(minutes: number) {
  const s = await getSession()
  if (!s || !(LOCK_CHOICES as readonly number[]).includes(minutes)) return
  const { maxIdle } = await unlockPolicy()
  if (maxIdle && minutes > maxIdle) return
  await prefs(s.user.id)
  await db
    .update(secretSettings)
    .set({ lockMinutes: minutes })
    .where(eq(secretSettings.userId, s.user.id))
}
