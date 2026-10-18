// Run: node --test lib/vault-crypto.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CHUNK,
  CIPHER_CHUNK,
  cipherSize,
  cipherSlice,
  decName,
  decryptStream,
  encName,
  nameTag,
  newFileKey,
  newVault,
  openFileKey,
  plainSize,
  plainSlice,
  rewrap,
  unlockWithPassphrase,
  unlockWithRecovery,
} from "./vault-crypto.ts"

const FAST = { t: 1, m: 1024 }

function plain(size: number) {
  const b = new Uint8Array(size)
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) & 255
  return b
}

async function encryptAll(fk: CryptoKey, pt: Uint8Array<ArrayBuffer>) {
  const read = async (s: number, e: number) => pt.subarray(s, e)
  return cipherSlice(fk, pt.length, read, 0, cipherSize(pt.length))
}

async function decryptAll(
  fk: CryptoKey,
  ct: Uint8Array<ArrayBuffer>,
  pieces = 1000_003
) {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      for (let i = 0; i < ct.length; i += pieces)
        c.enqueue(ct.subarray(i, i + pieces))
      c.close()
    },
  })
  const out = await new Response(
    stream.pipeThrough(decryptStream(fk))
  ).arrayBuffer()
  return new Uint8Array(out)
}

test("passphrase, recovery code and rewrap all open the same vault key", async () => {
  const v = await newVault("correct horse battery", FAST)
  assert.match(v.recoveryCode, /^([A-Z2-9]{4}-){12}[A-Z2-9]{4}$/)
  const name = await encName(v.vk, { n: "taxes.pdf", t: "application/pdf" })

  const a = await unlockWithPassphrase(v, "correct horse battery")
  assert.deepEqual(await decName(a, name), {
    n: "taxes.pdf",
    t: "application/pdf",
  })
  await assert.rejects(unlockWithPassphrase(v, "wrong horse battery"))

  const b = await unlockWithRecovery(
    v.recoveryWrapped,
    v.recoveryCode.toLowerCase()
  )
  assert.equal((await decName(b, name)).n, "taxes.pdf")
  await assert.rejects(
    unlockWithRecovery(v.recoveryWrapped, "AAAA-".repeat(12) + "AAAA")
  )

  const r = await rewrap(b, "a brand new passphrase", FAST)
  const c = await unlockWithPassphrase(r, "a brand new passphrase")
  assert.equal((await decName(c, name)).n, "taxes.pdf")
})

test("files round-trip at every chunk edge and cipherSize is exact", async () => {
  const v = await newVault("pass phrase here", FAST)
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK]) {
    const { fk, wrapped } = await newFileKey(v.vk)
    const pt = plain(size)
    const ct = await encryptAll(fk, pt)
    assert.equal(ct.length, cipherSize(size), `size ${size}`)
    assert.equal(plainSize(ct.length), size, `size ${size}`)
    const fk2 = await openFileKey(v.vk, wrapped)
    assert.deepEqual(await decryptAll(fk2, ct), pt, `size ${size}`)
  }
})

test("slices match the whole ciphertext, so resumed uploads send the same bytes", async () => {
  const v = await newVault("pass phrase here", FAST)
  const { fk } = await newFileKey(v.vk)
  const pt = plain(2 * CHUNK + 5)
  const read = async (s: number, e: number) => pt.subarray(s, e)
  const whole = await encryptAll(fk, pt)
  const part = await cipherSlice(
    fk,
    pt.length,
    read,
    CIPHER_CHUNK - 3,
    2 * CIPHER_CHUNK + 4
  )
  assert.deepEqual(part, whole.subarray(CIPHER_CHUNK - 3, 2 * CIPHER_CHUNK + 4))
})

test("tampering, reordering and truncation all fail", async () => {
  const v = await newVault("pass phrase here", FAST)
  const { fk } = await newFileKey(v.vk)
  const ct = await encryptAll(fk, plain(2 * CHUNK + 10))

  const flipped = ct.slice()
  flipped[5] ^= 1
  await assert.rejects(decryptAll(fk, flipped))

  const swapped = new Uint8Array(ct.length)
  swapped.set(ct.subarray(CIPHER_CHUNK, 2 * CIPHER_CHUNK))
  swapped.set(ct.subarray(0, CIPHER_CHUNK), CIPHER_CHUNK)
  swapped.set(ct.subarray(2 * CIPHER_CHUNK), 2 * CIPHER_CHUNK)
  await assert.rejects(decryptAll(fk, swapped))

  await assert.rejects(decryptAll(fk, ct.subarray(0, 2 * CIPHER_CHUNK)))
  await assert.rejects(decryptAll(fk, ct.subarray(0, ct.length - 1)))
})

test("plainSlice decrypts any range, reading only the chunks it needs", async () => {
  const { fk } = await newFileKey((await newVault("x".repeat(12), FAST)).vk)
  const pt = plain(2 * CHUNK + 5)
  const ct = await encryptAll(fk, pt)
  let read = 0
  const from = async (s: number, e: number) => {
    read += e - s
    return ct.subarray(s, e)
  }
  for (const [s, e] of [
    [0, pt.length],
    [0, 1],
    [CHUNK - 3, CHUNK + 3],
    [2 * CHUNK, 2 * CHUNK + 5],
    [7, 7],
  ]) {
    read = 0
    assert.deepEqual(
      await plainSlice(fk, ct.length, from, s, e),
      pt.subarray(s, e)
    )
    if (e - s && e - s < CHUNK) assert.ok(read <= 2 * CIPHER_CHUNK)
  }
  assert.equal((await plainSlice(fk, 16, from, 0, 0)).length, 0)
})

test("name tags ignore case and differ between vaults", async () => {
  const a = (await newVault("x".repeat(12), FAST)).vk
  const b = (await newVault("x".repeat(12), FAST)).vk
  assert.equal(await nameTag(a, "Taxes.PDF"), await nameTag(a, "taxes.pdf"))
  assert.notEqual(await nameTag(a, "taxes.pdf"), await nameTag(a, "taxes.pd"))
  assert.notEqual(await nameTag(a, "taxes.pdf"), await nameTag(b, "taxes.pdf"))
})
