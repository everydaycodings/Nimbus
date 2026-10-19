// Run: node --test lib/backup/file-crypto.test.ts
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { test } from "node:test"

import { decryptFile, decryptStream, encryptStream } from "./file-crypto.ts"

const key = randomBytes(32)
const seal = (data: Buffer, chunk = 7) =>
  buffer(
    Readable.from(
      Array.from({ length: Math.ceil(data.length / chunk) || 1 }, (_, i) =>
        data.subarray(i * chunk, (i + 1) * chunk)
      )
    ).pipe(encryptStream(key))
  )
const open = (data: Buffer, k = key) =>
  buffer(Readable.from([data]).pipe(decryptStream(k)))

test("round trips any size, in any chunking", async () => {
  for (const n of [0, 1, 15, 16, 17, 100_000]) {
    const plain = randomBytes(n)
    const sealed = await seal(plain)
    assert.equal(sealed.length, n + 4 + 12 + 16)
    assert.deepEqual(await open(sealed), plain)
    // One byte at a time exercises the header and tag buffering.
    const bytes = [...sealed].map((b) => Buffer.from([b]))
    assert.deepEqual(
      await buffer(Readable.from(bytes).pipe(decryptStream(key))),
      plain
    )
  }
})

test("tampering, truncation and the wrong key fail", async () => {
  const sealed = await seal(randomBytes(1000))
  const flipped = Buffer.from(sealed)
  flipped[500] ^= 1
  await assert.rejects(open(flipped), /integrity/)
  await assert.rejects(open(sealed.subarray(0, sealed.length - 1)), /integrity/)
  await assert.rejects(open(sealed, randomBytes(32)), /integrity/)
  await assert.rejects(open(Buffer.from("nope, not a backup")), /Not a Nimbus/)
})

test("decryptFile leaves nothing behind on failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nbk-"))
  const plain = randomBytes(5000)
  const sealed = await seal(plain)
  await writeFile(join(dir, "ok.enc"), sealed)
  await decryptFile(join(dir, "ok.enc"), join(dir, "ok"), key)
  assert.deepEqual(await readFile(join(dir, "ok")), plain)

  sealed[100] ^= 1
  await writeFile(join(dir, "bad.enc"), sealed)
  await assert.rejects(decryptFile(join(dir, "bad.enc"), join(dir, "bad"), key))
  await assert.rejects(readFile(join(dir, "bad")))
  await assert.rejects(readFile(join(dir, "bad.partial")))
})
