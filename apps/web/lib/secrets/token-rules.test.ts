import assert from "node:assert/strict"
import { test } from "node:test"

import { hashToken, ipAllowed, newToken, normPath, pathInScope, validIpEntry } from "./token-rules.ts"

test("tokens are prefixed, unique and hash stably", () => {
  const a = newToken("nms_")
  assert.match(a, /^nms_[A-Za-z0-9_-]{32}$/)
  assert.notEqual(a, newToken("nms_"))
  assert.equal(hashToken(a), hashToken(a))
  assert.match(hashToken(a), /^[0-9a-f]{64}$/)
})

test("folder scope", () => {
  assert.equal(normPath("/app//api/"), "app/api")
  assert.ok(pathInScope("", "/anything"))
  assert.ok(pathInScope("/app", "app/api"))
  assert.ok(pathInScope("app", "/app"))
  assert.ok(!pathInScope("app", "application"))
  assert.ok(!pathInScope("app/api", "app"))
})

test("ip allowlist", () => {
  assert.ok(ipAllowed(null, "1.2.3.4"))
  assert.ok(ipAllowed([], null))
  assert.ok(!ipAllowed(["1.2.3.4"], null))
  assert.ok(ipAllowed(["1.2.3.4"], "::ffff:1.2.3.4"))
  assert.ok(!ipAllowed(["1.2.3.4"], "1.2.3.5"))
  assert.ok(ipAllowed(["10.0.0.0/8"], "10.9.8.7"))
  assert.ok(!ipAllowed(["10.0.0.0/8"], "11.0.0.1"))
  assert.ok(ipAllowed(["192.168.1.0/24", "::1"], "::1"))
  assert.ok(ipAllowed(["0.0.0.0/0"], "8.8.8.8"))
  assert.ok(validIpEntry("10.0.0.0/8") && validIpEntry("::1") && !validIpEntry("10.0.0.0/33") && !validIpEntry("nope"))
})
