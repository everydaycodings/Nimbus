// Run: node --test lib/crypto.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.BETTER_AUTH_SECRET = "test-secret-one"
const { encrypt, decrypt } = await import("./crypto.ts")

test("round-trips, uses a fresh IV, rejects tampering and other secrets", () => {
  const sealed = encrypt("smtp-p4ss ✓")
  assert.equal(decrypt(sealed), "smtp-p4ss ✓")
  assert.notEqual(encrypt("x"), encrypt("x"))
  assert.equal(decrypt(sealed.slice(0, -2) + "AA"), null)
  assert.equal(decrypt("garbage"), null)
  process.env.BETTER_AUTH_SECRET = "test-secret-two"
  assert.equal(decrypt(sealed), null)
})
