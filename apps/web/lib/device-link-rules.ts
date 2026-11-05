// Pure rules for signing in a phone from the web: the one-time QR token and the
// short code that stands in for it when typing. Run: node --test lib/device-link-rules.test.ts
import { createHash, randomBytes, randomInt } from "node:crypto"

export const LINK_TTL_MS = 2 * 60 * 1000
// Time the device gets to collect its session after the web says yes.
export const APPROVED_TTL_MS = 2 * 60 * 1000

// No 0/O, 1/I/L or U, so a code survives being read aloud or typed on a phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
const CODE_LENGTH = 8

export const hashSecret = (s: string) =>
  createHash("sha256").update(s).digest("hex")

export const newToken = () => randomBytes(32).toString("base64url")

export function newCode() {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

export const formatCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`

// However it was typed: lowercase, with the dash or spaces. Null when it can't be a code.
export function normalizeCode(raw: string) {
  const code = raw.toUpperCase().replace(/[\s-]/g, "")
  if (code.length !== CODE_LENGTH) return null
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null
}

// What the QR holds: where to go and the one-time token. Never a password.
export const linkUri = (server: string, token: string) =>
  `nimbus://link?${new URLSearchParams({ server, token })}`
