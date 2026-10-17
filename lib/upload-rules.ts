// Pure upload helpers: path checks, "Keep both" names, the upload token and
// Content-Disposition. No `@/` imports, so lib/upload-rules.test.ts runs them
// under node --test.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"

// Splits "Photos/2024/a.jpg" into names, or null if any name is unusable.
export function splitPath(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null
  const names = raw.split("/")
  const ok = names.every(
    (n) =>
      n.trim() &&
      n.length <= 255 &&
      n !== "." &&
      n !== ".." &&
      !/[\\\0]/.test(n)
  )
  return ok ? names : null
}

// Lowercase, without the dot: "a.JPG" → "jpg". Dotfiles like ".env" have none.
export function extOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

// The lowest free "name (n).ext". `taken` holds lowercased names.
export function freeName(name: string, taken: Set<string>, folder = false) {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [base, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 1; ; n++) {
    const next = `${base} (${n})${ext}`
    if (!taken.has(next.toLowerCase())) return next
  }
}

// RFC 6266 with an RFC 5987 filename* for non-ASCII names.
export function contentDisposition(filename: string, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_")
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

// The upload token binds a user and a target folder: base64url(JSON).hmac.
export type UploadToken = { u: string; p: string | null; exp: number }

const DAY = 24 * 60 * 60 * 1000

function mac(body: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  const key = Buffer.from(
    hkdfSync("sha256", secret, "", "nimbus:upload-token:v1", 32)
  )
  return createHmac("sha256", key).update(body).digest()
}

export function signUploadToken(
  userId: string,
  parentId: string | null,
  now = Date.now()
) {
  const body = Buffer.from(
    JSON.stringify({ u: userId, p: parentId, exp: now + DAY })
  ).toString("base64url")
  return `${body}.${mac(body).toString("base64url")}`
}

// Checks the signature only. pre-create also checks `exp`; finishing doesn't,
// since a huge upload can outlive the token.
export function readUploadToken(token: unknown): UploadToken | null {
  if (typeof token !== "string") return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const got = Buffer.from(sig, "base64url")
  const want = mac(body)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    return typeof t.u === "string" && typeof t.exp === "number" ? t : null
  } catch {
    return null
  }
}

// "2 GB", "500 MB": how the admin entered the upload limit.
export function sizeLabel(bytes: number) {
  const gb = bytes / 2 ** 30
  return gb >= 1
    ? `${+gb.toFixed(2)} GB`
    : `${+(bytes / 2 ** 20).toFixed(2)} MB`
}
