// Writes the vectors the Android module's VaultTest checks against: everything here is made by the
// web code in ../vault-crypto.ts. Run: node packages/shared/scripts/vault-vectors.ts
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { argon2id } from "hash-wasm"
import {
  CHUNK,
  cipherSlice,
  cipherSize,
  encName,
  exportLinkKey,
  linkKeyWrap,
  newLinkKey,
  sealManifest,
  wrapForLink,
  fromB64,
  newFileKey,
  newVault,
  nameTag,
  toB64,
} from "../vault-crypto.ts"

const out = new URL(
  "../../../apps/mobile/modules/nimbus-android/android/src/test/resources/",
  import.meta.url
)
const subtle = globalThis.crypto.subtle
const raw = async (k: CryptoKey) => new Uint8Array(await subtle.exportKey("raw", k))

// Not periodic in 256 or in CHUNK, so a swapped chunk can't match by accident.
export const pattern = (i: number) => (i * 131 + (i >>> 8) * 7 + (i >>> 16) * 13) & 255

const kdf = async (t: number, m: number, password: string, salt: string) => ({
  t,
  m,
  out: toB64(
    (await argon2id({
      password,
      salt: fromB64(salt),
      iterations: t,
      memorySize: m,
      parallelism: 1,
      hashLength: 32,
      outputType: "binary",
    })) as Uint8Array
  ),
})

const salt = toB64(Uint8Array.from({ length: 16 }, (_, i) => i))
const kdfPass = "pässword ünïcode 日本語"
const fast = { t: 1, m: 1024 }
const passphrase = "correct horse battery stápled"
const v = await newVault(passphrase, fast)
const vk = v.vk
const fk = await newFileKey(vk)
const fkRaw = await raw(fk.fk)

const size = Math.floor(CHUNK * 2.5)
const plain = Uint8Array.from({ length: size }, (_, i) => pattern(i))
const read = async (s: number, e: number) => plain.slice(s, e)
const cipher = await cipherSlice(fk.fk, size, read, 0, cipherSize(size))

const tiny = Uint8Array.from({ length: 13 }, (_, i) => pattern(i))
const small = async (n: number) =>
  toB64(await cipherSlice(fk.fk, n, async (s, e) => tiny.slice(s, e), 0, cipherSize(n)))

const names = [
  { n: "report.pdf", t: "application/pdf" },
  { n: "Ünïcode 日本語 🙂.txt", t: null },
]
const tagInputs = ["Report.PDF", "Résumé.DOCX", "Résumé.DOCX".normalize("NFD"), "İstanbul.txt"]

const lk = await newLinkKey()
const linkManifest = [
  { path: "Docs/report.pdf", size, mime: "application/pdf", versionId: "00000000-0000-4000-8000-000000000001", fileKey: await wrapForLink(lk, fk.fk) },
]
const linkPass = "ünï link phrase"
const linkWrap = await linkKeyWrap(linkPass, lk, fast)

const vectors = {
  kdf: {
    password: kdfPass,
    salt,
    real: await kdf(3, 64 * 1024, kdfPass.normalize("NFC"), salt),
    fast: await kdf(1, 1024, kdfPass.normalize("NFC"), salt),
  },
  vault: {
    passphrase,
    recoveryCode: v.recoveryCode,
    keys: { salt: v.salt, kdf: v.kdf, wrapped: v.wrapped, recoveryWrapped: v.recoveryWrapped },
    vk: toB64(await raw(vk)),
  },
  names: await Promise.all(names.map(async (x) => ({ ...x, sealed: await encName(vk, x) }))),
  tags: await Promise.all(tagInputs.map(async (name) => ({ name, tag: await nameTag(vk, name) }))),
  // Share links: Kotlin must open all of this, and seal things the web opens (see vault-crypto.ts).
  link: {
    key: await exportLinkKey(lk),
    fileKey: linkManifest[0].fileKey, // wraps file.fk
    manifest: await sealManifest(lk, linkManifest),
    manifestJson: JSON.stringify(linkManifest),
    passphrase: linkPass,
    wrap: linkWrap,
  },
  file: {
    fk: toB64(fkRaw),
    wrapped: fk.wrapped,
    size,
    cipherLength: cipher.length,
    cipherSha256: createHash("sha256").update(cipher).digest("hex"),
    empty: await small(0),
    tiny: { size: 13, cipher: await small(13) },
  },
}

writeFileSync(new URL("vault-vectors.json", out), JSON.stringify(vectors, null, 1))
console.log("wrote vectors,", cipher.length, "cipher bytes (hashed, not stored)")
