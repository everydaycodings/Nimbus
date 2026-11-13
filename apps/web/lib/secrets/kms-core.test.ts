// Run: node --test lib/secrets/kms-core.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import * as k from "./kms-core.ts"

test("aes: round trip, context binding, version picked from the token", () => {
  const v1 = k.newMaterial("aes").material
  const v2 = k.newMaterial("aes").material
  const old = k.encrypt("pay", 1, v1, Buffer.from("card ✓"), "order-7")
  const now = k.encrypt("pay", 2, v2, Buffer.from("card ✓"), "order-7")
  assert.equal(k.parseToken(old).version, 1)
  assert.equal(k.parseToken(now).version, 2)
  // Rotation: the old version still opens its own output; the new one is a different key.
  assert.equal(k.decrypt(v1, old, "order-7").toString(), "card ✓")
  assert.equal(k.decrypt(v2, now, "order-7").toString(), "card ✓")
  assert.throws(() => k.decrypt(v2, old, "order-7"))
  assert.throws(() => k.decrypt(v1, old, "order-8"))
  assert.throws(() => k.decrypt(v1, old))
  assert.throws(() => k.decrypt(v1, old.slice(0, -3) + "AAA", "order-7"))
  assert.notEqual(k.encrypt("pay", 1, v1, Buffer.from("x")), k.encrypt("pay", 1, v1, Buffer.from("x")))
  assert.equal(k.decrypt(v1, k.encrypt("pay", 1, v1, Buffer.alloc(0))).length, 0)
})

for (const kind of ["ed25519", "p256"] as const)
  test(`${kind}: sign and verify, old versions still verify, tampering fails`, () => {
    const a = k.newMaterial(kind)
    const b = k.newMaterial(kind)
    const data = Buffer.from("release-1.2.3.tgz")
    const s1 = k.sign("rel", 1, kind, a.material, data)
    const s2 = k.sign("rel", 2, kind, b.material, data)
    assert.ok(k.verify(kind, a.publicKey!, data, s1))
    assert.ok(k.verify(kind, b.publicKey!, data, s2))
    assert.equal(k.verify(kind, b.publicKey!, data, s1), false)
    assert.equal(k.verify(kind, a.publicKey!, Buffer.from("other"), s1), false)
    assert.equal(k.verify(kind, a.publicKey!, data, "nkms:v1:rel:1:AAAA"), false)
  })

test("tokens and names are validated", () => {
  assert.throws(() => k.parseToken("garbage"))
  assert.ok(k.KMS_NAME_RE.test("deploy-key_1.a"))
  assert.ok(!k.KMS_NAME_RE.test("a:b"))
  assert.ok(!k.KMS_NAME_RE.test(""))
})
