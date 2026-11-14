import assert from "node:assert/strict"
import { test } from "node:test"

import { clientIp, hashToken, ipAllowed, newToken, normPath, pathInScope, validIpEntry } from "./token-rules.ts"

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

test("client IP is the proxy's, not a forwarded-for the caller wrote", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h })
  // nginx: X-Forwarded-For $proxy_add_x_forwarded_for (caller's value, then the real one).
  assert.equal(clientIp(req({ "x-forwarded-for": "10.9.8.7, 203.0.113.5", "x-real-ip": "203.0.113.5" })), "203.0.113.5")
  assert.equal(clientIp(req({ "x-forwarded-for": "10.9.8.7, 203.0.113.5" })), "203.0.113.5")
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.5" })), "203.0.113.5")
  assert.equal(clientIp(req({})), null)
  assert.ok(!ipAllowed(["10.9.8.7"], clientIp(req({ "x-forwarded-for": "10.9.8.7, 203.0.113.5" }))))
})
