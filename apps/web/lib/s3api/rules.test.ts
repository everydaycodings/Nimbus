// Run: node --test lib/s3api/rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { bucketNameError, endpoint, newKeyPair, suggestBucketName } from "./rules.ts"

test("key pairs look like AWS keys", () => {
  const k = newKeyPair()
  assert.match(k.accessKeyId, /^NMS3[A-Z2-7]{16}$/)
  assert.equal(k.secret.length, 40)
  assert.match(k.secret, /^[A-Za-z0-9]+$/)
})

test("bucket names follow S3 rules", () => {
  for (const ok of ["abc", "my-backups", "tf.state", "a".repeat(63)]) assert.equal(bucketNameError(ok), null, ok)
  for (const bad of ["ab", "a".repeat(64), "Abc", "-abc", "abc-", "a..b", "192.168.1.1", "a_b", "xn--abc"])
    assert.notEqual(bucketNameError(bad), null, bad)
})

test("suggested names are valid", () => {
  for (const f of ["My Backups", "Ünïcode Földer", "x", "..", "Terraform State!!"])
    assert.equal(bucketNameError(suggestBucketName(f)), null, f)
  assert.equal(suggestBucketName("My Backups"), "my-backups")
})

test("endpoint only when set up", () => {
  assert.equal(endpoint({}), null)
  assert.equal(endpoint({ S3API_DOMAIN: "s3api.example.com" }), "https://s3api.example.com")
  assert.equal(endpoint({ S3API_DOMAIN: "http://localhost:3407/" }), "http://localhost:3407")
})
