// offline-vault/lib/crypto.ts
// Specialized crypto for the Offline Vault.
// All cryptography runs in the browser using the Web Crypto API.
// The password and derived key NEVER leave the client.

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const LOCAL_VAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

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
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

// ── Encrypt/Decrypt ───────────────────────────────────────────
// Returns a Blob containing: [IV (12 bytes)] + [AES-GCM ciphertext]
export async function encryptBuffer(data: ArrayBuffer, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  const result = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_BYTES);
  return result;
}

export async function decryptBuffer(encryptedData: Uint8Array, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = encryptedData.slice(0, IV_BYTES);
  const ciphertext = encryptedData.slice(IV_BYTES);

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
}

// ── Password Verification Token ───────────────────────────────
// Encrypts a known string to verify the password later.
export async function createVerificationToken(key: CryptoKey): Promise<string> {
  const payload = new TextEncoder().encode("nimbus-local-vault-ok");
  const encrypted = await encryptBuffer(payload.buffer as ArrayBuffer, key);
  return bufferToBase64(encrypted);
}

export async function verifyPassword(key: CryptoKey, token: string): Promise<boolean> {
  try {
    const encryptedData = base64ToBuffer(token);
    const decrypted = await decryptBuffer(encryptedData, key);
    return new TextDecoder().decode(decrypted) === "nimbus-local-vault-ok";
  } catch {
    return false;
  }
}

// ── Encoding helpers ─────────────────────────────────────────
export function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  buffer.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer;
}
