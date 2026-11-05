import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatCode,
  hashSecret,
  linkUri,
  newCode,
  newToken,
  normalizeCode,
} from "./device-link-rules.ts"

test("codes read back however they're typed", () => {
  const code = newCode()
  assert.equal(code.length, 8)
  assert.equal(normalizeCode(code), code)
  assert.equal(normalizeCode(formatCode(code)), code)
  assert.equal(normalizeCode(` ${formatCode(code).toLowerCase()} `), code)
})

test("impossible codes are refused", () => {
  for (const bad of ["", "ABC", "ABCD-EFGHJ", "ABCD-EF0H", "ABCD-EFIH", "ABCD EFOH"])
    assert.equal(normalizeCode(bad), null, bad)
})

test("tokens are long, unique, and stored hashed", () => {
  const a = newToken()
  assert.ok(a.length >= 43)
  assert.notEqual(a, newToken())
  assert.notEqual(hashSecret(a), a)
  assert.equal(hashSecret(a), hashSecret(a))
})

test("the QR carries the server and token, safely encoded", () => {
  const u = new URL(linkUri("https://files.example.net/a b", "tok+/="))
  assert.equal(u.protocol, "nimbus:")
  assert.equal(u.searchParams.get("server"), "https://files.example.net/a b")
  assert.equal(u.searchParams.get("token"), "tok+/=")
  assert.deepEqual([...u.searchParams.keys()].sort(), ["server", "token"])
})
