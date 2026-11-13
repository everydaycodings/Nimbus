// RFC 6238 one-time codes and otpauth:// URIs.
import { createHmac } from "node:crypto"

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32(s: string) {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "")
  let bits = ""
  for (const ch of clean) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error("That isn't a valid TOTP secret (base32).")
    bits += v.toString(2).padStart(5, "0")
  }
  const out: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}

export type TotpOpts = { digits?: number; period?: number; algorithm?: "SHA1" | "SHA256" | "SHA512" }

export function totp(secret: string | Buffer, atMs: number, o: TotpOpts = {}) {
  const key = typeof secret === "string" ? base32(secret) : secret
  const digits = o.digits ?? 6
  const period = o.period ?? 30
  const ctr = Buffer.alloc(8)
  ctr.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / period)))
  const h = createHmac((o.algorithm ?? "SHA1").toLowerCase(), key).update(ctr).digest()
  const off = h[h.length - 1] & 0xf
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits
  return {
    code: String(n).padStart(digits, "0"),
    remaining: period - (Math.floor(atMs / 1000) % period),
    period,
  }
}

// "otpauth://totp/Issuer:me?secret=…&issuer=…&digits=6&period=30&algorithm=SHA1" or a bare secret.
export function parseOtpauth(input: string) {
  const t = input.trim()
  if (!/^otpauth:\/\//i.test(t)) {
    base32(t)
    return { secret: t.replace(/\s/g, "").toUpperCase() } as { secret: string } & TotpOpts & { issuer?: string; label?: string }
  }
  const u = new URL(t)
  if (u.hostname !== "totp") throw new Error("Only time-based (totp) codes are supported.")
  const secret = u.searchParams.get("secret")
  if (!secret) throw new Error("That otpauth link has no secret.")
  base32(secret)
  const alg = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase()
  const digits = Number(u.searchParams.get("digits") ?? 6)
  const period = Number(u.searchParams.get("period") ?? 30)
  if (!["SHA1", "SHA256", "SHA512"].includes(alg) || ![6, 7, 8].includes(digits) || !(period >= 5 && period <= 300))
    throw new Error("That otpauth link uses settings that aren't supported.")
  return {
    secret: secret.replace(/\s/g, "").toUpperCase(),
    algorithm: alg as "SHA1",
    digits,
    period,
    issuer: u.searchParams.get("issuer") ?? undefined,
    label: decodeURIComponent(u.pathname.slice(1)) || undefined,
  }
}
