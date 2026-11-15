import assert from "node:assert/strict"
import test from "node:test"

import { backfillKey, expiryOf, fits, splitLegacy } from "./connection-rules.ts"

test("fits: GitHub sources take GitHub tokens, SSH keys only SSH addresses", () => {
  assert.ok(fits("github", { kind: "github", url: "a/b" }))
  assert.ok(!fits("git", { kind: "github", url: "a/b" }))
  assert.ok(!fits("github", { kind: "git", url: "https://x.io/a.git" }))
  assert.ok(fits("gitlab", { kind: "git", url: "https://x.io/a.git" }))
  assert.ok(!fits("ssh", { kind: "git", url: "https://x.io/a.git" }))
  assert.ok(fits("ssh", { kind: "git", url: "git@x.io:a/b.git" }))
  assert.ok(!fits("git", { kind: "git", url: "git@x.io:a/b.git" }))
})

test("expiry windows", () => {
  const now = new Date("2026-01-10T00:00:00Z")
  assert.equal(expiryOf(null, now).state, "none")
  assert.equal(expiryOf(new Date("2026-03-01T00:00:00Z"), now).state, "ok")
  assert.deepEqual(expiryOf(new Date("2026-01-17T00:00:00Z"), now), { state: "soon", days: 7 })
  assert.equal(expiryOf(new Date("2026-01-10T00:00:00Z"), now).state, "expired")
  assert.equal(expiryOf(new Date("2026-01-01T00:00:00Z"), now).state, "expired")
})

test("backfill: legacy credentials split and dedupe", () => {
  assert.deepEqual(splitLegacy("github", "ghp_x"), { provider: "github", secret: "ghp_x", username: null })
  assert.deepEqual(splitLegacy("git", JSON.stringify({ username: "me", token: "t" })), { provider: "git", secret: "t", username: "me" })
  assert.equal(splitLegacy("git", JSON.stringify({ sshKey: "K\n" }))?.provider, "ssh")
  assert.equal(splitLegacy("git", "not json"), null)
  assert.equal(backfillKey("n", "github", "s"), backfillKey("n", "github", "s"))
  assert.notEqual(backfillKey("n", "github", "s"), backfillKey("m", "github", "s"))
  assert.notEqual(backfillKey("n", "github", "s"), backfillKey("n", "git", "s"))
})
