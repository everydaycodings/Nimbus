// Secrets encryption. SECRETS_ROOT_KEY (32 bytes, base64 or 64 hex) wraps each
// project's random data key; the data key seals every value with AES-256-GCM.
// Separate from BETTER_AUTH_SECRET. Rotating the root key = unwrap + wrap each
// project key again (S6); values are not touched.
// Relative-import safe so node --test can load it.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export function rootKey() {
  const raw = (process.env.SECRETS_ROOT_KEY ?? "").trim()
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  if (key.length !== 32)
    throw new Error("SECRETS_ROOT_KEY must be 32 bytes (openssl rand -base64 32).")
  return key
}

export const kmsConfigured = () => {
  try {
    rootKey()
    return true
  } catch {
    return false
  }
}

// Format: v1.<iv>.<tag>.<ciphertext>, base64url. `aad` binds the blob to its owner.
function seal(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv)
  c.setAAD(Buffer.from(aad))
  const data = Buffer.concat([c.update(plain), c.final()])
  return ["v1", iv, c.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".")
}

function open(key: Buffer, sealed: string, aad: string) {
  const [v, iv, tag, data] = sealed.split(".")
  if (v !== "v1" || !iv || !tag || data === undefined)
    throw new Error("Unreadable secret.")
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()])
}

// A fresh project data key, already wrapped, and the same key to use right away.
export function newProjectKey(projectId: string) {
  const key = randomBytes(32)
  return { key, wrapped: seal(rootKey(), key, `project:${projectId}`) }
}

export const unwrapProjectKey = (projectId: string, wrapped: string) =>
  open(rootKey(), wrapped, `project:${projectId}`)

export const sealValue = (key: Buffer, projectId: string, plain: string) =>
  seal(key, Buffer.from(plain, "utf8"), `value:${projectId}`)

export const openValue = (key: Buffer, projectId: string, sealed: string) =>
  open(key, sealed, `value:${projectId}`).toString("utf8")

// Share links aren't tied to a project, so their text is sealed with the root key itself.
export const sealServer = (plain: string) => seal(rootKey(), Buffer.from(plain, "utf8"), "share")
export const openServer = (sealed: string) => open(rootKey(), sealed, "share").toString("utf8")
