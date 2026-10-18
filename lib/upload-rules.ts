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

export { extOf, freeName } from "./file-rules.ts"

// RFC 6266 with an RFC 5987 filename* for non-ASCII names.
export function contentDisposition(filename: string, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_")
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

// Signed tokens: base64url(JSON).hmac, with a key per purpose so one kind
// can't stand in for another.
const DAY = 24 * 60 * 60 * 1000

function mac(purpose: string, body: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  const key = Buffer.from(
    hkdfSync("sha256", secret, "", `nimbus:${purpose}:v1`, 32)
  )
  return createHmac("sha256", key).update(body).digest()
}

export function signToken(
  purpose: string,
  payload: object,
  ttl: number,
  now = Date.now()
) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + ttl })
  ).toString("base64url")
  return `${body}.${mac(purpose, body).toString("base64url")}`
}

// Checks the signature only; callers decide whether `exp` matters.
export function readToken<T extends { exp: number }>(
  purpose: string,
  token: unknown
): T | null {
  if (typeof token !== "string") return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const got = Buffer.from(sig, "base64url")
  const want = mac(purpose, body)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    return typeof t.exp === "number" ? t : null
  } catch {
    return null
  }
}

// The upload token binds the folder's owner (`u`) and folder (`p`) to who is
// uploading: a member (`b`, missing when it's the owner) or a file-drop link
// (`s`, with the name the uploader typed in `l` and their IP in `i`). Vault
// uploads carry the vault (`v`); `p` null is then the vault's root.
export type UploadToken = {
  u: string
  p: string | null
  b?: string
  s?: string
  l?: string
  i?: string
  v?: string
  exp: number
}

export function signUploadToken(
  ownerId: string,
  parentId: string | null,
  now = Date.now(),
  by: Pick<UploadToken, "b" | "s" | "l" | "i" | "v"> = {}
) {
  return signToken("upload-token", { u: ownerId, p: parentId, ...by }, DAY, now)
}

// pre-create also checks `exp`; finishing doesn't, since a huge upload can
// outlive the token.
export function readUploadToken(token: unknown): UploadToken | null {
  const t = readToken<UploadToken>("upload-token", token)
  return t && typeof t.u === "string" ? t : null
}

// "2 GB", "500 MB": how the admin entered the upload limit.
export function sizeLabel(bytes: number) {
  const gb = bytes / 2 ** 30
  return gb >= 1
    ? `${+gb.toFixed(2)} GB`
    : `${+(bytes / 2 ** 20).toFixed(2)} MB`
}
