// Relative-import safe: lib/auth.ts pulls this in through lib/email.ts.
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

// Secrets saved from the admin panel (SMTP password, Resend key) are sealed with
// AES-256-GCM under a key derived from BETTER_AUTH_SECRET. Rotating that secret
// makes them unreadable, so they have to be entered again.
function key() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  return Buffer.from(
    hkdfSync("sha256", secret, "", "nimbus:settings-secret:v1", 32)
  )
}

// Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".")
}

// Returns null when the value was sealed under a different secret or was tampered with.
export function decrypt(sealed: string) {
  const [v, iv, tag, data] = sealed.split(".")
  if (v !== "v1" || !iv || !tag || !data) return null
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url")
    )
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}
