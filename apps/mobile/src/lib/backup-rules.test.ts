import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_SETTINGS, describe, ringOf, type BackupStatus } from "./backup-rules.ts"

const on = { ...DEFAULT_SETTINGS, enabled: true, accountId: "a" }
const status = (s: Partial<BackupStatus>): BackupStatus => ({ state: "idle", done: 0, total: 0, failed: [], access: "all", ...s })

test("the ring shows only on the account being backed up", () => {
  assert.equal(ringOf(DEFAULT_SETTINGS, status({}), "a"), null)
  assert.equal(ringOf(on, status({}), "b"), null)
  assert.deepEqual(ringOf(on, status({}), "a"), { color: "brand", progress: 1 })
})

test("the ring fills while uploading and turns red when failing or without access", () => {
  assert.deepEqual(ringOf(on, status({ state: "running", done: 1, total: 4 }), "a"), { color: "brand", progress: 0.25 })
  assert.equal(ringOf(on, status({ state: "failing" }), "a")?.color, "destructive")
  assert.equal(ringOf(on, status({ access: "none" }), "a")?.color, "destructive")
})

test("the strip always says why it's waiting", () => {
  const now = Date.parse("2026-11-06T12:00:00Z")
  assert.deepEqual(describe(status({ state: "waiting", reason: "Waiting for Wi-Fi", lastAt: now - 120_000 }), now), {
    title: "Waiting for Wi-Fi",
    detail: "Last backed up 2 min ago",
  })
  assert.equal(describe(status({ state: "running", done: 11, total: 340 }), now).title, "Backing up 12 of 340")
  assert.equal(describe(status({}), now).detail, "Nothing backed up yet")
})
