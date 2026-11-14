// Secrets encryption. SECRETS_ROOT_KEY (32 bytes, base64 or 64 hex) wraps each
// project's random data key; the data key seals every value with AES-256-GCM.
// Separate from BETTER_AUTH_SECRET. Rotating the root key = unwrap + wrap each
// project key again (lib/secrets/root-rotate.ts); values are not touched.
// Relative-import safe so node --test can load it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

function parseKey(raw: string, name: string) {
  raw = raw.trim()
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes (openssl rand -base64 32).`)
  return key
}

export const rootKey = () => parseKey(process.env.SECRETS_ROOT_KEY ?? "", "SECRETS_ROOT_KEY")

// The key being rotated away from (SECRETS_ROOT_KEY_PREVIOUS): reading still works with
// it until every root-sealed value has been re-wrapped under the new key.
export function previousRootKey() {
  const raw = (process.env.SECRETS_ROOT_KEY_PREVIOUS ?? "").trim()
  return raw ? parseKey(raw, "SECRETS_ROOT_KEY_PREVIOUS") : null
}

// A short public name for a key: sha256 of a labelled copy, never the key itself.
export const fingerprint = (k: Buffer) =>
  createHash("sha256").update("nimbus-root-key:").update(k).digest("hex").slice(0, 16)

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

// Opens with the current root key, else the previous one while a rotation is under way.
function openRoot(sealed: string, aad: string) {
  try {
    return open(rootKey(), sealed, aad)
  } catch (e) {
    const prev = previousRootKey()
    if (!prev) throw e
    return open(prev, sealed, aad)
  }
}

// True when only the previous root key opens this (it still needs re-wrapping).
export function needsRewrap(sealed: string, aad: string) {
  try {
    open(rootKey(), sealed, aad)
    return false
  } catch {
    return previousRootKey() !== null
  }
}

// The same plaintext sealed again under the current root key.
export const rewrap = (sealed: string, aad: string) => seal(rootKey(), openRoot(sealed, aad), aad)

export const projectAad = (projectId: string) => `project:${projectId}`
export const SHARE_AAD = "share"

export const unwrapProjectKey = (projectId: string, wrapped: string) =>
  openRoot(wrapped, `project:${projectId}`)

export const sealValue = (key: Buffer, projectId: string, plain: string) =>
  seal(key, Buffer.from(plain, "utf8"), `value:${projectId}`)

export const openValue = (key: Buffer, projectId: string, sealed: string) =>
  open(key, sealed, `value:${projectId}`).toString("utf8")

export const TICKET_AAD = "ssh-ticket"

// Share links aren't tied to a project, so their text is sealed with the root key itself.
// `aad` keeps each use apart: an SSH terminal ticket can't pass for a share link's text.
export const sealServer = (plain: string, aad = SHARE_AAD) => seal(rootKey(), Buffer.from(plain, "utf8"), aad)
export const openServer = (sealed: string, aad = SHARE_AAD) => openRoot(sealed, aad).toString("utf8")
