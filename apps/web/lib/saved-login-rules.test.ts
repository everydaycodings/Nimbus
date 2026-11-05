import assert from "node:assert/strict"
import { test } from "node:test"

import {
  hashSecret,
  mayUse,
  savedCookies,
  secretMatches,
  stillValid,
} from "./saved-login-rules.ts"

const ID = "0b9e6c1e-6f1a-4c55-9a44-3f2a1d0c9b11"

test("reads only well-formed saved-login cookies", () => {
  const m = savedCookies([
    { name: `nimbus_saved_${ID}`, value: "s3cret" },
    { name: "nimbus_saved_not-a-uuid", value: "x" },
    { name: `nimbus_saved_${ID.replace("0b", "0c")}`, value: "" },
    { name: "better-auth.session_token", value: "t" },
  ])
  assert.deepEqual([...m], [[ID, "s3cret"]])
})

test("secret matches only its own hash", () => {
  const h = hashSecret("abc")
  assert.ok(secretMatches("abc", h))
  assert.ok(!secretMatches("abd", h))
  assert.ok(!secretMatches("abc", "deadbeef"))
})

test("expires, and dies with a later password change", () => {
  const now = new Date("2026-10-29T12:00:00Z")
  const row = {
    createdAt: new Date("2026-10-01T00:00:00Z"),
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  }
  assert.ok(stillValid(row, null, now))
  assert.ok(stillValid(row, new Date("2026-09-01T00:00:00Z"), now))
  assert.ok(!stillValid(row, new Date("2026-10-15T00:00:00Z"), now))
  assert.ok(!stillValid({ ...row, expiresAt: now }, null, now))
})

test("admins need the admin switch", () => {
  const on = { savedLogins: true, savedLoginsAdmins: false }
  assert.ok(mayUse("member", on))
  assert.ok(!mayUse("admin", on))
  assert.ok(!mayUse("owner", on))
  assert.ok(mayUse("owner", { ...on, savedLoginsAdmins: true }))
  assert.ok(!mayUse("member", { ...on, savedLogins: false }))
})
