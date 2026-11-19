// Run: node --test lib/s3api/cidr.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { cidrError, ipAllowed } from "./cidr.ts"

test("empty list allows anywhere", () => {
  assert.ok(ipAllowed("1.2.3.4", []))
  assert.ok(ipAllowed(null, null))
})

test("IPv4 addresses and ranges", () => {
  const l = ["203.0.113.0/24", "198.51.100.7"]
  assert.ok(ipAllowed("203.0.113.200", l))
  assert.ok(ipAllowed("198.51.100.7", l))
  assert.ok(!ipAllowed("203.0.114.1", l))
  assert.ok(!ipAllowed("198.51.100.8", l))
  assert.ok(ipAllowed("9.9.9.9", ["0.0.0.0/0"]))
})

test("IPv6 addresses and ranges", () => {
  const l = ["2001:db8::/32", "::1"]
  assert.ok(ipAllowed("2001:db8:ffff::5", l))
  assert.ok(ipAllowed("::1", l))
  assert.ok(!ipAllowed("2001:db9::1", l))
  assert.ok(!ipAllowed("1.2.3.4", l))
})

test("IPv4-mapped IPv6 counts as IPv4", () => {
  assert.ok(ipAllowed("::ffff:203.0.113.5", ["203.0.113.0/24"]))
  assert.ok(ipAllowed("203.0.113.5", ["::ffff:203.0.113.0/120"]))
})

test("a request with no address is refused when a list is set", () => {
  assert.ok(!ipAllowed(null, ["1.2.3.4"]))
  assert.ok(!ipAllowed("nonsense", ["1.2.3.4"]))
})

test("syntax errors", () => {
  for (const bad of ["", "1.2.3", "1.2.3.256", "1.2.3.4/33", "1.2.3.4/", "::/129", "1::2::3", "1:2:3:4:5:6:7:8:9", "abc", "1.2.3.4/8/8"])
    assert.ok(cidrError(bad), bad)
  for (const ok of ["1.2.3.4", "10.0.0.0/8", "::", "::1", "fe80::/10", "2001:db8::1/128", "1:2:3:4:5:6:7:8"])
    assert.equal(cidrError(ok), null, ok)
})
