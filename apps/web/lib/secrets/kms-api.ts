// The KMS API's data side: a project's named keys, their versions, and the four
// operations. Key material is sealed with the project data key (like every secret)
// and never leaves here; callers get ciphertext, signatures and public keys only.
import "server-only"

import { and, asc, desc, eq, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretKmsKeys, secretKmsVersions } from "@/lib/db/schema"
import {
  KMS_KINDS,
  KMS_MAX_BYTES,
  KMS_NAME_RE,
  decrypt,
  encrypt,
  newMaterial,
  parseToken,
  sign,
  verify,
  type KmsKind,
} from "./kms-core"
import { SecretsError, seal, unseal, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)
const MAX_KEYS = 100

export type KmsOp = "encrypt" | "decrypt" | "sign" | "verify"

export async function listKmsKeys(c: Ctx) {
  const keys = await db.select().from(secretKmsKeys).where(eq(secretKmsKeys.projectId, c.projectId)).orderBy(asc(secretKmsKeys.name))
  const vers = keys.length
    ? await db
        .select({ keyId: secretKmsVersions.keyId, version: secretKmsVersions.version, publicKey: secretKmsVersions.publicKey, createdAt: secretKmsVersions.createdAt })
        .from(secretKmsVersions)
        .innerJoin(secretKmsKeys, eq(secretKmsKeys.id, secretKmsVersions.keyId))
        .where(eq(secretKmsKeys.projectId, c.projectId))
        .orderBy(desc(secretKmsVersions.version))
    : []
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    kind: k.kind,
    state: k.state,
    latest: k.latest,
    createdAt: k.createdAt.toISOString(),
    versions: vers
      .filter((v) => v.keyId === k.id)
      .map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), publicKey: v.publicKey })),
  }))
}

async function getKey(c: Ctx, ref: string) {
  const uuid = /^[0-9a-f-]{36}$/i.test(ref)
  const [k] = await db
    .select()
    .from(secretKmsKeys)
    .where(and(eq(secretKmsKeys.projectId, c.projectId), uuid ? eq(secretKmsKeys.id, ref) : eq(secretKmsKeys.name, ref)))
  if (!k) throw bad("No key by that name in this project.", 404)
  return k
}

async function addVersion(c: Ctx, keyId: string, kind: KmsKind, version: number) {
  const m = newMaterial(kind)
  await db.insert(secretKmsVersions).values({ keyId, version, materialEnc: seal(c, m.material), publicKey: m.publicKey })
}

export async function createKmsKey(c: Ctx, o: { name: string; kind: string }) {
  const name = o.name.trim()
  if (!KMS_NAME_RE.test(name)) throw bad("Key names use letters, digits, dot, dash and underscore (up to 64).")
  if (!KMS_KINDS.includes(o.kind as KmsKind)) throw bad("Pick AES-256-GCM, Ed25519 or ECDSA P-256.")
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from secret_kms_keys where project_id = ${c.projectId}`)
  if (n >= MAX_KEYS) throw bad(`A project holds up to ${MAX_KEYS} KMS keys.`)
  const [k] = await db
    .insert(secretKmsKeys)
    .values({ projectId: c.projectId, name, kind: o.kind as KmsKind, createdBy: c.userId || null })
    .onConflictDoNothing()
    .returning()
  if (!k) throw bad("A key with that name already exists.", 409)
  await addVersion(c, k.id, k.kind, 1)
  await audit("secrets_kms_key_create", { detail: `${name} (${k.kind})` })
  return k.id
}

// A new version: later encrypt and sign calls use it; older ones still decrypt and verify.
export async function rotateKmsKey(c: Ctx, ref: string) {
  const k = await getKey(c, ref)
  const [u] = await db
    .update(secretKmsKeys)
    .set({ latest: sql`${secretKmsKeys.latest} + 1` })
    .where(eq(secretKmsKeys.id, k.id))
    .returning({ latest: secretKmsKeys.latest })
  await addVersion(c, k.id, k.kind, u.latest)
  await audit("secrets_kms_key_rotate", { detail: `${k.name} to version ${u.latest}` })
  return u.latest
}

export async function setKmsState(c: Ctx, ref: string, enabled: boolean) {
  const k = await getKey(c, ref)
  await db.update(secretKmsKeys).set({ state: enabled ? "enabled" : "disabled" }).where(eq(secretKmsKeys.id, k.id))
  await audit(enabled ? "secrets_kms_key_enable" : "secrets_kms_key_disable", { detail: k.name })
}

export async function deleteKmsKey(c: Ctx, ref: string) {
  const k = await getKey(c, ref)
  await db.delete(secretKmsKeys).where(eq(secretKmsKeys.id, k.id))
  await audit("secrets_kms_key_delete", { detail: `${k.name} (${k.kind}), everything it encrypted is now unreadable` })
}

const bytes = (b64: unknown, what: string) => {
  if (typeof b64 !== "string") throw bad(`${what} must be base64 text.`)
  const buf = Buffer.from(b64, "base64")
  if (buf.length > KMS_MAX_BYTES) throw bad(`${what} is over 1 MB.`, 413)
  return buf
}

export type OpInput = { key: string; data?: string; ciphertext?: string; signature?: string; context?: string }

// Runs one operation. Returns the answer and a line for the audit log (sizes and versions only).
export async function kmsOperation(c: Ctx, op: KmsOp, i: OpInput) {
  const k = await getKey(c, i.key)
  if (k.state !== "enabled") throw bad("That key is disabled.", 409)
  const useAes = op === "encrypt" || op === "decrypt"
  if (useAes !== (k.kind === "aes"))
    throw bad(useAes ? "That key signs; it can't encrypt or decrypt." : "That key encrypts; it can't sign or verify.", 409)
  const ver = async (n: number) => {
    const [v] = await db
      .select()
      .from(secretKmsVersions)
      .where(and(eq(secretKmsVersions.keyId, k.id), eq(secretKmsVersions.version, n)))
    if (!v) throw bad(`That key has no version ${n}.`, 404)
    return v
  }
  const context = i.context?.slice(0, 1000)
  try {
    if (op === "encrypt") {
      const data = bytes(i.data, "data")
      const v = await ver(k.latest)
      const ciphertext = encrypt(k.name, v.version, unseal(c, v.materialEnc), data, context)
      return { out: { ciphertext, version: v.version }, detail: `${k.name} v${v.version}, ${data.length} bytes` }
    }
    if (op === "decrypt") {
      if (typeof i.ciphertext !== "string") throw bad("ciphertext is required.")
      const t = parseToken(i.ciphertext)
      if (t.name !== k.name) throw bad("That ciphertext was made by a different key.")
      const v = await ver(t.version)
      const plain = decrypt(unseal(c, v.materialEnc), i.ciphertext, context)
      return { out: { data: plain.toString("base64"), version: v.version }, detail: `${k.name} v${v.version}, ${plain.length} bytes` }
    }
    if (op === "sign") {
      const data = bytes(i.data, "data")
      const v = await ver(k.latest)
      const signature = sign(k.name, v.version, k.kind, unseal(c, v.materialEnc), data)
      return { out: { signature, version: v.version }, detail: `${k.name} v${v.version}, ${data.length} bytes` }
    }
    const data = bytes(i.data, "data")
    if (typeof i.signature !== "string") throw bad("signature is required.")
    const t = parseToken(i.signature)
    if (t.name !== k.name) throw bad("That signature was made by a different key.")
    const v = await ver(t.version)
    const valid = verify(k.kind, v.publicKey!, data, i.signature)
    return { out: { valid, version: v.version }, detail: `${k.name} v${v.version}, ${valid ? "valid" : "invalid"}` }
  } catch (e) {
    if (e instanceof SecretsError) throw e
    // Bad ciphertext, wrong context or a tampered value: say so without echoing anything.
    throw bad(op === "decrypt" ? "Couldn't decrypt: wrong key, wrong context, or the value was changed." : "That value isn't valid.")
  }
}
