// "Save your login info": the rules, kept pure for tests (saved-login-rules.test.ts).
import { createHash, timingSafeEqual } from "node:crypto"

export const SAVED_PREFIX = "nimbus_saved_"
export const SAVED_DAYS = 90
export const SAVED_MAX_AGE = SAVED_DAYS * 24 * 60 * 60

// Set by a fresh sign-in; the app offers to save that account once.
export const OFFER_SAVE_COOKIE = "nimbus_offer_save"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const hashSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex")

// The saved-login cookies in a request, as id → secret.
export function savedCookies(all: { name: string; value: string }[]) {
  const out = new Map<string, string>()
  for (const { name, value } of all) {
    const id = name.startsWith(SAVED_PREFIX) && name.slice(SAVED_PREFIX.length)
    if (id && UUID.test(id) && value) out.set(id, value)
  }
  return out
}

export function secretMatches(secret: string, hash: string) {
  const a = Buffer.from(hashSecret(secret), "hex")
  const b = Buffer.from(hash, "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}

// Expired, or older than the password it was saved under, means it no longer works.
export function stillValid(
  row: { createdAt: Date; expiresAt: Date },
  passwordChangedAt: Date | null,
  now = new Date()
) {
  return (
    row.expiresAt > now &&
    (!passwordChangedAt || row.createdAt > passwordChangedAt)
  )
}

export function mayUse(
  role: string,
  s: { savedLogins: boolean; savedLoginsAdmins: boolean }
) {
  return s.savedLogins && (role === "member" || s.savedLoginsAdmins)
}
