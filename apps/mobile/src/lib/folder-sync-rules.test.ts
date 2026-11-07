import assert from "node:assert/strict"
import { test } from "node:test"

import { describePair, summary, type SyncPair } from "./folder-sync-rules.ts"

const pair = (p: Partial<SyncPair>): SyncPair => ({
  id: "1", accountId: "a", name: "Docs", folderName: "Documents", remotePath: "My files/Docs", twoWay: true, paused: false,
  state: "idle", reason: null, up: 0, down: 0, removed: 0, conflicts: 0, done: 0, total: 0, failed: 0, ...p,
})

test("the last run is summed up in words", () => {
  assert.equal(summary(pair({})), "Nothing changed")
  assert.equal(summary(pair({ up: 2, down: 1, removed: 1, conflicts: 1 })), "2 uploaded, 1 saved to phone, 1 removed, 1 conflict")
})

test("each state has its own line", () => {
  const now = Date.now()
  assert.equal(describePair(pair({}), now), "Not synced yet")
  assert.equal(describePair(pair({ state: "paused" }), now), "Paused")
  assert.equal(describePair(pair({ state: "running", done: 1, total: 4 }), now), "Syncing 2 of 4")
  assert.equal(describePair(pair({ state: "waiting", reason: "Waiting for Wi-Fi" }), now), "Waiting for Wi-Fi")
  assert.equal(describePair(pair({ lastAt: now - 5 * 60_000, up: 1, failed: 2 }), now), "2 problems · 1 uploaded · 5 min ago")
})
