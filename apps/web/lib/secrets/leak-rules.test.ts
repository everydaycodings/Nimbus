// Run: node --test lib/secrets/leak-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import * as r from "./leak-rules.ts"

// Built from parts so this file doesn't trip real scanners.
const aws = "AKIA" + "QYLPMN5HHHFPZAM2"
const gh = "ghp_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5"
const stripe = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dcQ9aB"
const slack = "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"
const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
const pem = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun\n-----END RSA PRIVATE KEY-----"

test("finds provider keys with line numbers and masks them", () => {
  const text = `# config\naws_key = ${aws}\nGH=${gh}\n\nSTRIPE: "${stripe}"\nslack ${slack}\nt=${jwt}\n${pem}\n`
  const f = r.scanText(text)
  const by = Object.fromEntries(f.map((x) => [x.rule, x]))
  assert.equal(by["aws-access-key"].line, 2)
  assert.equal(by["github-token"].line, 3)
  assert.equal(by["stripe-key"].line, 5)
  assert.equal(by["slack-token"].line, 6)
  assert.equal(by["jwt"].line, 7)
  assert.equal(by["private-key"].line, 8)
  for (const x of f) {
    assert.ok(!x.masked.includes(x.match) || x.match.length < 5, x.rule)
    assert.ok(x.masked.length <= 40)
    assert.match(x.hash, /^[0-9a-f]{32}$/)
  }
  assert.equal(by["aws-access-key"].masked, "AKIA…M2")
})

test("generic rule needs entropy and ignores placeholders and code", () => {
  const hit = r.scanText('const client_secret = "Zr4u7xAD0GKaPdSgVkYp3s6v9yB5/Bq"\napi_key: 8f3a9c2e7b1d4f6a0e5c9b2d7a1f3e8c')
  assert.equal(hit.length, 2)
  assert.deepEqual(hit.map((x) => x.line), [1, 2])
  const miss = r.scanText(
    [
      'password = "changeme"',
      "API_KEY=your_api_key_here",
      "token = process.env.TOKEN_VALUE_FROM_ENV",
      'secret: "<your-secret-goes-here>"',
      "password=xxxxxxxxxxxxxxxxxxxx",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "const passwordResetTokenName = other",
      "token = ${SECRET_TOKEN_VALUE}",
      'auth_key = "aaaaaaaaaaaaaaaaaaaaaaaa"',
    ].join("\n")
  )
  assert.deepEqual(miss, [])
})

test("an allow list of hashes silences a finding, dupes are reported once", () => {
  const text = `a=${aws}\nb=${aws}\n`
  const [one] = r.scanText(text)
  assert.equal(r.scanText(text).length, 1)
  assert.deepEqual(r.scanText(text, new Set([one.hash])), [])
})

test("scannable picks text and code, not binaries, lock files or big files", () => {
  assert.ok(r.scannable("deploy.sh", null, 400))
  assert.ok(r.scannable(".env.production", null, 400))
  assert.ok(r.scannable("notes", "text/plain", 400))
  assert.ok(!r.scannable("photo.jpg", "image/jpeg", 400))
  assert.ok(!r.scannable("package-lock.json", "application/json", 400))
  assert.ok(!r.scannable("app.min.js", null, 400))
  assert.ok(!r.scannable("big.log", "text/plain", r.SCAN_MAX_BYTES + 1))
  assert.ok(!r.scannable("empty.txt", "text/plain", 0))
  assert.ok(r.looksBinary(new Uint8Array([65, 0, 66])))
  assert.ok(!r.looksBinary(new TextEncoder().encode("plain")))
})

test("redact replaces every copy", () => {
  assert.equal(r.redact(`k=${aws}; again ${aws}`, aws), "k=REDACTED; again REDACTED")
})
