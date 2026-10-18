// Vault encryption, shared by the browser and Node (tests). Nothing here talks to the server.
//
// A vault key (VK) is wrapped twice: by Argon2id(passphrase) and by HKDF(recovery code).
// Names are AES-GCM under VK. Each file has its own key (FK, wrapped by VK) and is cut into
// CHUNK-sized pieces, each sealed with nonce = chunk index and AAD = index + "is last", so
// reordered, swapped or truncated ciphertext fails to open.

export const CHUNK = 4 * 1024 * 1024
const TAG = 16
export const CIPHER_CHUNK = CHUNK + TAG
export const KDF = { t: 3, m: 64 * 1024 } // m in KiB

// WebCrypto wants buffers that can't be shared.
type Bytes = Uint8Array<ArrayBuffer>

const subtle = globalThis.crypto.subtle
const random = (n: number) =>
  globalThis.crypto.getRandomValues(new Uint8Array(n))
const GCM = { name: "AES-GCM", length: 256 } as const

export function toB64(bytes: Uint8Array) {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function sealKey(key: CryptoKey, kek: CryptoKey) {
  const iv = random(12)
  const ct = new Uint8Array(
    await subtle.wrapKey("raw", key, kek, { name: "AES-GCM", iv })
  )
  return toB64(concat([iv, ct]))
}

// Throws when `kek` is the wrong key: GCM refuses to open.
async function openKey(sealed: string, kek: CryptoKey) {
  const b = fromB64(sealed)
  return subtle.unwrapKey(
    "raw",
    b.subarray(12),
    kek,
    { name: "AES-GCM", iv: b.subarray(0, 12) },
    GCM,
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  )
}

export async function passphraseKey(
  passphrase: string,
  salt: string,
  kdf: { t: number; m: number } = KDF
) {
  // Loaded on first unlock, not with every page that can upload.
  const { argon2id } = await import("hash-wasm")
  const raw = await argon2id({
    password: passphrase.normalize("NFC"),
    salt: fromB64(salt),
    iterations: kdf.t,
    memorySize: kdf.m,
    parallelism: 1,
    hashLength: 32,
    outputType: "binary",
  })
  return subtle.importKey("raw", raw as Bytes, "AES-GCM", false, [
    "wrapKey",
    "unwrapKey",
  ])
}

// Recovery codes are 32 random bytes in base32, grouped by 4 for reading aloud.
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function recoveryBytes(code: string) {
  const chars = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
  let bits = 0
  let acc = 0
  const out: number[] = []
  for (const c of chars) {
    const v = B32.indexOf(c)
    if (v < 0) throw new Error("bad recovery code")
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 255)
    }
  }
  if (out.length !== 32) throw new Error("bad recovery code")
  return new Uint8Array(out)
}

function recoveryCode(bytes: Uint8Array) {
  let bits = 0
  let acc = 0
  let s = ""
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      s += B32[(acc >> bits) & 31]
    }
  }
  if (bits) s += B32[(acc << (5 - bits)) & 31]
  return s.match(/.{1,4}/g)!.join("-")
}

async function recoveryKey(code: string) {
  const base = await subtle.importKey(
    "raw",
    recoveryBytes(code),
    "HKDF",
    false,
    ["deriveKey"]
  )
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: new TextEncoder().encode("nimbus-vault-recovery"),
    },
    base,
    GCM,
    false,
    ["wrapKey", "unwrapKey"]
  )
}

export async function newVault(passphrase: string, kdf = KDF) {
  const vk = await subtle.generateKey(GCM, true, [
    "encrypt",
    "decrypt",
    "wrapKey",
    "unwrapKey",
  ])
  const salt = toB64(random(16))
  const code = recoveryCode(random(32))
  return {
    vk,
    salt,
    kdf,
    recoveryCode: code,
    wrapped: await sealKey(vk, await passphraseKey(passphrase, salt, kdf)),
    recoveryWrapped: await sealKey(vk, await recoveryKey(code)),
  }
}

export async function unlockWithPassphrase(
  v: { salt: string; wrapped: string; kdf: { t: number; m: number } },
  passphrase: string
) {
  return openKey(v.wrapped, await passphraseKey(passphrase, v.salt, v.kdf))
}

export async function unlockWithRecovery(
  recoveryWrapped: string,
  code: string
) {
  return openKey(recoveryWrapped, await recoveryKey(code))
}

// New salt and wrapped key for a changed passphrase; files and the recovery copy stay as they are.
export async function rewrap(vk: CryptoKey, passphrase: string, kdf = KDF) {
  const salt = toB64(random(16))
  return {
    salt,
    kdf,
    wrapped: await sealKey(vk, await passphraseKey(passphrase, salt, kdf)),
  }
}

export type SealedName = { n: string; t: string | null }

export async function encName(vk: CryptoKey, name: SealedName) {
  const iv = random(12)
  const pt = new TextEncoder().encode(JSON.stringify(name))
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, vk, pt)
  )
  return toB64(concat([iv, ct]))
}

export async function decName(
  vk: CryptoKey,
  sealed: string
): Promise<SealedName> {
  const b = fromB64(sealed)
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: b.subarray(0, 12) },
    vk,
    b.subarray(12)
  )
  return JSON.parse(new TextDecoder().decode(pt))
}

// A name's fingerprint, so the server can refuse two same-named items in one
// folder without reading either. Case-insensitive, like names elsewhere, and
// meaningless without the vault key.
const tagKeys = new WeakMap<CryptoKey, Promise<CryptoKey>>()
async function tagKey(vk: CryptoKey) {
  const base = await subtle.importKey(
    "raw",
    await subtle.exportKey("raw", vk),
    "HKDF",
    false,
    ["deriveKey"]
  )
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: new TextEncoder().encode("nimbus-vault-names"),
    },
    base,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
}

export async function nameTag(vk: CryptoKey, name: string) {
  if (!tagKeys.has(vk)) tagKeys.set(vk, tagKey(vk))
  const mac = await subtle.sign(
    "HMAC",
    await tagKeys.get(vk)!,
    new TextEncoder().encode(name.normalize("NFC").toLowerCase())
  )
  return toB64(new Uint8Array(mac).subarray(0, 16))
}

export async function newFileKey(vk: CryptoKey) {
  const fk = await subtle.generateKey(GCM, true, ["encrypt", "decrypt"])
  return { fk, wrapped: await sealKey(fk, vk) }
}

export const openFileKey = (vk: CryptoKey, wrapped: string) =>
  openKey(wrapped, vk)

const chunkCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK))
export const cipherSize = (size: number) => size + TAG * chunkCount(size)
// The server only knows the ciphertext size.
export const plainSize = (cipher: number) =>
  cipher - TAG * Math.max(1, Math.ceil(cipher / CIPHER_CHUNK))

function nonceAad(index: number, last: boolean) {
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setBigUint64(4, BigInt(index))
  const aad = new Uint8Array(9)
  aad.set(iv.subarray(4))
  aad[8] = last ? 1 : 0
  return { name: "AES-GCM", iv, additionalData: aad }
}

export async function encryptChunk(
  fk: CryptoKey,
  index: number,
  last: boolean,
  pt: Bytes
) {
  return new Uint8Array(await subtle.encrypt(nonceAad(index, last), fk, pt))
}

export async function decryptChunk(
  fk: CryptoKey,
  index: number,
  last: boolean,
  ct: Bytes
) {
  return new Uint8Array(await subtle.decrypt(nonceAad(index, last), fk, ct))
}

// Ciphertext bytes [start, end) of a file of `size` plaintext bytes, encrypting only the chunks
// that cover the range. `read` returns plaintext bytes [s, e).
export async function cipherSlice(
  fk: CryptoKey,
  size: number,
  read: (s: number, e: number) => Promise<Bytes>,
  start: number,
  end: number
) {
  const total = cipherSize(size)
  end = Math.min(end, total)
  if (start >= end) return new Uint8Array()
  const first = Math.floor(start / CIPHER_CHUNK)
  const lastIndex = chunkCount(size) - 1
  const parts: Bytes[] = []
  for (let i = first; i * CIPHER_CHUNK < end; i++) {
    const pt = await read(i * CHUNK, Math.min(size, (i + 1) * CHUNK))
    parts.push(await encryptChunk(fk, i, i === lastIndex, pt))
  }
  const off = first * CIPHER_CHUNK
  return concat(parts).subarray(start - off, end - off)
}

// Plaintext bytes [start, end) of a file of `cipher` ciphertext bytes, decrypting only the
// chunks that cover the range. `read` returns ciphertext bytes [s, e).
export async function plainSlice(
  fk: CryptoKey,
  cipher: number,
  read: (s: number, e: number) => Promise<Bytes>,
  start: number,
  end: number
) {
  const size = plainSize(cipher)
  end = Math.min(end, size)
  if (start >= end) return new Uint8Array()
  const first = Math.floor(start / CHUNK)
  const last = Math.floor((end - 1) / CHUNK)
  const lastIndex = chunkCount(size) - 1
  const ct = await read(
    first * CIPHER_CHUNK,
    Math.min(cipher, (last + 1) * CIPHER_CHUNK)
  )
  const parts: Bytes[] = []
  for (let i = first; i <= last; i++) {
    const o = (i - first) * CIPHER_CHUNK
    parts.push(
      await decryptChunk(
        fk,
        i,
        i === lastIndex,
        ct.subarray(o, o + CIPHER_CHUNK)
      )
    )
  }
  const off = first * CHUNK
  return concat(parts).subarray(start - off, end - off)
}

// Plaintext stream from a ciphertext stream. The last chunk is whatever is left at the end, so a
// stream cut on a chunk boundary still fails (the chunk before it wasn't sealed as last).
export function decryptStream(fk: CryptoKey) {
  let buf: Bytes = new Uint8Array()
  let index = 0
  return new TransformStream<Bytes, Bytes>({
    async transform(piece, ctrl) {
      buf = concat([buf, piece])
      while (buf.length > CIPHER_CHUNK) {
        ctrl.enqueue(
          await decryptChunk(fk, index++, false, buf.subarray(0, CIPHER_CHUNK))
        )
        buf = buf.slice(CIPHER_CHUNK)
      }
    },
    async flush(ctrl) {
      if (!buf.length) throw new Error("vault file is truncated")
      ctrl.enqueue(await decryptChunk(fk, index, true, buf))
    },
  })
}

function concat(parts: Bytes[]): Bytes {
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
