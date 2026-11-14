// Run: node --test lib/secrets/kms.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.SECRETS_ROOT_KEY = Buffer.alloc(32, 1).toString("base64")
const k = await import("./kms.ts")

test("wraps a project key and seals values that only it opens", () => {
  const { key, wrapped } = k.newProjectKey("p1")
  assert.deepEqual(k.unwrapProjectKey("p1", wrapped), key)
  const sealed = k.sealValue(key, "p1", "s3cret ✓\nline2")
  assert.equal(k.openValue(key, "p1", sealed), "s3cret ✓\nline2")
  assert.notEqual(k.sealValue(key, "p1", "x"), k.sealValue(key, "p1", "x"))
  assert.equal(k.openValue(key, "p1", k.sealValue(key, "p1", "")), "")
})

test("rejects tampering, other projects, other keys and a bad root key", () => {
  const { key, wrapped } = k.newProjectKey("p1")
  const sealed = k.sealValue(key, "p1", "v")
  assert.throws(() => k.openValue(key, "p1", sealed.slice(0, -2) + "AA"))
  assert.throws(() => k.openValue(key, "p2", sealed))
  assert.throws(() => k.unwrapProjectKey("p2", wrapped))
  assert.throws(() => k.openValue(k.newProjectKey("p1").key, "p1", sealed))
  process.env.SECRETS_ROOT_KEY = Buffer.alloc(32, 2).toString("hex")
  assert.throws(() => k.unwrapProjectKey("p1", wrapped))
  process.env.SECRETS_ROOT_KEY = "short"
  assert.equal(k.kmsConfigured(), false)
  assert.throws(() => k.newProjectKey("p1"))
})

test("root-sealed text is bound to its use: an SSH ticket isn't a share link", () => {
  process.env.SECRETS_ROOT_KEY = Buffer.alloc(32, 1).toString("base64")
  const ticket = k.sealServer('{"userId":"u"}', k.TICKET_AAD)
  assert.equal(k.openServer(ticket, k.TICKET_AAD), '{"userId":"u"}')
  assert.throws(() => k.openServer(ticket))
  assert.throws(() => k.openServer(k.sealServer("shared text"), k.TICKET_AAD))
})
