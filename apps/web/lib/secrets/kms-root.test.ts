// Run: node --test lib/secrets/kms-root.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

const OLD = Buffer.alloc(32, 7).toString("base64")
const NEW = Buffer.alloc(32, 9).toString("hex")
process.env.SECRETS_ROOT_KEY = OLD
const k = await import("./kms.ts")

test("rewrapping moves project keys and share text to the new root key", () => {
  const { key, wrapped } = k.newProjectKey("p1")
  const share = k.sealServer("one-time text")
  const sealed = k.sealValue(key, "p1", "db password")

  // Rotation starts: new key current, old key previous. Everything still opens.
  process.env.SECRETS_ROOT_KEY = NEW
  process.env.SECRETS_ROOT_KEY_PREVIOUS = OLD
  assert.deepEqual(k.unwrapProjectKey("p1", wrapped), key)
  assert.equal(k.openServer(share), "one-time text")
  assert.ok(k.needsRewrap(wrapped, k.projectAad("p1")))
  assert.ok(k.needsRewrap(share, k.SHARE_AAD))

  const wrapped2 = k.rewrap(wrapped, k.projectAad("p1"))
  const share2 = k.rewrap(share, k.SHARE_AAD)
  assert.ok(!k.needsRewrap(wrapped2, k.projectAad("p1")))
  assert.equal(k.fingerprint(k.rootKey()).length, 16)
  assert.notEqual(k.fingerprint(k.rootKey()), k.fingerprint(k.previousRootKey()!))

  // Previous key dropped: only the re-wrapped data opens, and values were never touched.
  delete process.env.SECRETS_ROOT_KEY_PREVIOUS
  assert.deepEqual(k.unwrapProjectKey("p1", wrapped2), key)
  assert.equal(k.openServer(share2), "one-time text")
  assert.equal(k.openValue(k.unwrapProjectKey("p1", wrapped2), "p1", sealed), "db password")
  assert.throws(() => k.unwrapProjectKey("p1", wrapped))
  assert.throws(() => k.openServer(share))
  // Binding to the owner survives the re-wrap.
  assert.throws(() => k.unwrapProjectKey("p2", wrapped2))
  assert.equal(k.needsRewrap(wrapped, k.projectAad("p1")), false)
})

test("a bad previous key is an error, a missing one is not", () => {
  process.env.SECRETS_ROOT_KEY = OLD
  delete process.env.SECRETS_ROOT_KEY_PREVIOUS
  assert.equal(k.previousRootKey(), null)
  process.env.SECRETS_ROOT_KEY_PREVIOUS = "nope"
  assert.throws(() => k.previousRootKey())
  delete process.env.SECRETS_ROOT_KEY_PREVIOUS
})
