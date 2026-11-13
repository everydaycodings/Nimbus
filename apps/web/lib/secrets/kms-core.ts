// The crypto behind the KMS API: key generation, AES-256-GCM encrypt/decrypt and
// Ed25519 / ECDSA P-256 sign/verify. No database here (relative imports only, so
// node --test loads it). Outputs are self-describing text:
//   nkms:v1:<key name>:<version>:<base64url payload>
// so decrypt and verify pick the right key version without being told.
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto"

export const KMS_KINDS = ["aes", "ed25519", "p256"] as const
export type KmsKind = (typeof KMS_KINDS)[number]
export const KMS_SCOPES = ["kms:encrypt", "kms:decrypt", "kms:sign", "kms:verify"] as const
export const KMS_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
export const KMS_MAX_BYTES = 1024 * 1024

export const kindUse = (k: KmsKind) => (k === "aes" ? "encrypt" : "sign")

// Fresh material: base64 of 32 random bytes (aes) or a PKCS8 PEM private key, plus the public PEM.
export function newMaterial(kind: KmsKind): { material: string; publicKey: string | null } {
  if (kind === "aes") return { material: randomBytes(32).toString("base64"), publicKey: null }
  const pair =
    kind === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("ec", { namedCurve: "P-256" })
  return {
    material: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

const tag = (name: string, version: number) => `nkms:v1:${name}:${version}:`

// Splits a token into its key name, version and payload; throws on anything else.
export function parseToken(token: string) {
  const m = /^nkms:v1:([^:]+):(\d+):([A-Za-z0-9_.-]+)$/.exec(token.trim())
  if (!m) throw new Error("That isn't a Nimbus KMS value.")
  return { name: m[1], version: Number(m[2]), payload: m[3] }
}

const aadOf = (name: string, context?: string) => Buffer.from(`${name}\u0000${context ?? ""}`)

// `context` is extra authenticated data: decrypt must give the same text back.
export function encrypt(name: string, version: number, material: string, plain: Buffer, context?: string) {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", Buffer.from(material, "base64"), iv)
  c.setAAD(aadOf(name, context))
  const data = Buffer.concat([c.update(plain), c.final()])
  return tag(name, version) + Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url")
}

export function decrypt(material: string, token: string, context?: string) {
  const { name, payload } = parseToken(token)
  const raw = Buffer.from(payload, "base64url")
  if (raw.length < 28) throw new Error("Unreadable ciphertext.")
  const d = createDecipheriv("aes-256-gcm", Buffer.from(material, "base64"), raw.subarray(0, 12))
  d.setAAD(aadOf(name, context))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()])
}

const alg = (kind: KmsKind) => (kind === "ed25519" ? null : "sha256")

export function sign(name: string, version: number, kind: KmsKind, material: string, data: Buffer) {
  const sig = cryptoSign(alg(kind), data, {
    key: createPrivateKey(material),
    ...(kind === "p256" && { dsaEncoding: "ieee-p1363" as const }),
  })
  return tag(name, version) + sig.toString("base64url")
}

export function verify(kind: KmsKind, publicKey: string, data: Buffer, token: string) {
  const { payload } = parseToken(token)
  try {
    return cryptoVerify(
      alg(kind),
      data,
      { key: createPublicKey(publicKey), ...(kind === "p256" && { dsaEncoding: "ieee-p1363" as const }) },
      Buffer.from(payload, "base64url")
    )
  } catch {
    return false
  }
}
