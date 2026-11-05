import assert from "node:assert/strict"
import { test } from "node:test"

import { isPrivateIp } from "./push-rules.ts"

test("private and special addresses are refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd12::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])
    assert.equal(isPrivateIp(ip), true, ip)
})

test("public addresses pass", () => {
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"])
    assert.equal(isPrivateIp(ip), false, ip)
})
