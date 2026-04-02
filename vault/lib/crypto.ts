// vault/lib/crypto.ts
// All cryptography runs in the browser using the Web Crypto API.
// The password and derived key NEVER leave the client.
//
// Max file size for vault: 100 MB
// Above this, AES-GCM would require buffering the entire file in memory
// which risks crashing the browser tab.

const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12
const DEFAULT_MAX_MB = 100
const MAX_MB = Number(process.env.NEXT_PUBLIC_VAULT_MAX_FILE_SIZE_MB || DEFAULT_MAX_MB)

export const VAULT_MAX_FILE_SIZE = MAX_MB * 1024 * 1024 // e.g., 100 MB
export const VAULT_MAX_PREVIEW_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const VAULT_MAX_FILE_SIZE_LABEL = `${MAX_MB} MB`

export const STEALTH_NAME_PREFIX = "Archive_"

// ── Key derivation ────────────────────────────────────────────
export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  const saltBuf = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength
  )

  const saltCopy = Uint8Array.from(salt) // always backed by ArrayBuffer
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltCopy, // or saltCopy.buffer
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

/**
 * Derives a deterministic UUID from the user ID and password.
 * This allows "discovery" of hidden vaults without them being linked to the user in a list.
 */
export async function deriveStealthId(
  userId: string,
  password: string
): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(userId + password + "nimbus-stealth-v1")
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = new Uint8Array(hashBuffer)

  // Use the first 16 bytes of the hash to create a UUID-like string
  // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const hex = Array.from(hashArray.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20, 32)}`
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES))
}

// ── Encrypt a file ────────────────────────────────────────────
// Returns a Blob of: [IV (12 bytes)] + [AES-GCM ciphertext]
export async function encryptFile(file: File, key: CryptoKey): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const fileBuffer = await file.arrayBuffer()

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    fileBuffer
  )

  const result = new Uint8Array(IV_BYTES + ciphertext.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(ciphertext), IV_BYTES)

  return new Blob([result], { type: "application/octet-stream" })
}

// ── Decrypt a file ────────────────────────────────────────────
export async function decryptFile(
  encryptedBlob: Blob,
  key: CryptoKey,
  originalMimeType: string
): Promise<Blob> {
  const buffer = await encryptedBlob.arrayBuffer()
  const data = new Uint8Array(buffer)
  const iv = data.slice(0, IV_BYTES)
  const ciphertext = data.slice(IV_BYTES)

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  )

  return new Blob([plaintext], { type: originalMimeType })
}

// ── Password verification token ───────────────────────────────
export async function encryptVerificationToken(
  key: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const payload = new TextEncoder().encode("nimbus-vault-ok")
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    payload
  )

  const combined = new Uint8Array(IV_BYTES + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), IV_BYTES)
  return bufferToBase64(combined)
}

export async function verifyPassword(
  key: CryptoKey,
  verificationToken: string
): Promise<boolean> {
  try {
    const combined = base64ToBuffer(verificationToken)
    const iv = combined.slice(0, IV_BYTES)
    const ciphertext = combined.slice(IV_BYTES)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    )
    return new TextDecoder().decode(plain) === "nimbus-vault-ok"
  } catch {
    return false
  }
}

// ── Encoding helpers ─────────────────────────────────────────
export function bufferToBase64(buffer: Uint8Array): string {
  let binary = ""
  buffer.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
  return buffer
}
