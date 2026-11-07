// Run: node --test lib/activity-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { ACTIVITY_TYPES, retentionCutoff, visibleTypes } from "./activity-rules.ts"

test("owners see every kind of event, others never the shares", () => {
  assert.deepEqual(visibleTypes("owner"), [...ACTIVITY_TYPES])
  for (const role of ["editor", "viewer"] as const) {
    assert.ok(!visibleTypes(role).includes("share"))
    assert.equal(visibleTypes(role).length, ACTIVITY_TYPES.length - 1)
  }
})

test("retention cutoff counts back whole days, and forever has none", () => {
  const now = Date.parse("2026-11-07T12:00:00Z")
  assert.equal(retentionCutoff(30, now)?.toISOString(), "2026-10-08T12:00:00.000Z")
  assert.equal(retentionCutoff(365, now)?.toISOString(), "2025-11-07T12:00:00.000Z")
  assert.equal(retentionCutoff(null, now), null)
  assert.equal(retentionCutoff(0, now), null)
})
