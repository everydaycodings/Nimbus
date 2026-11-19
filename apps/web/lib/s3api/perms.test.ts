// Run: node --test lib/s3api/perms.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { legacyAccess, prefixError, presetOf } from "./perms.ts"

test("presets are recognised in any order", () => {
  assert.equal(presetOf(["read", "list"]), "read")
  assert.equal(presetOf(["list", "read", "write"]), "append")
  assert.equal(presetOf(["delete", "write", "read", "list"]), "rw")
  assert.equal(presetOf(["write"]), "custom")
})

test("only keys without write map to the old read-only value", () => {
  assert.equal(legacyAccess(["list", "read"]), "ro")
  assert.equal(legacyAccess(["list", "read", "write"]), "rw")
})

test("prefixes", () => {
  assert.equal(prefixError(""), null)
  assert.equal(prefixError("photos/2024/"), null)
  assert.ok(prefixError("/photos/"))
  assert.ok(prefixError("a\\b"))
  assert.ok(prefixError("x".repeat(513)))
})
