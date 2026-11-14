// Run: node --test lib/registry/cleanup.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { selectCleanup } from "./cleanup.ts"

const now = new Date("2026-11-14T12:00:00Z")
const day = (n: number) => new Date(now.getTime() - n * 86_400_000)
const tags = [1, 2, 3, 4].map((n) => ({ name: `v${n}`, pushedAt: day(5 - n), lastPulledAt: null }))

test("keepLast=2 over four tags selects the two oldest", () => {
  assert.deepEqual(selectCleanup({ keepLast: 2 }, tags, [], null, now).tags.sort(), ["v1", "v2"])
  assert.deepEqual(selectCleanup({ keepLast: 2, keepPattern: "v1" }, tags, [], null, now).tags, ["v2"])
  assert.deepEqual(selectCleanup({ keepLast: 2, notPulledDays: 1 }, tags, [], null, now).tags.sort(), ["v1", "v2"])
})

test("immutable tags are skipped", () => {
  assert.deepEqual(selectCleanup({ keepLast: 2, notPulledDays: 1 }, tags, [], "v1", now).tags, ["v2"])
})

test("untagged: old, not protected", () => {
  const m = [
    { digest: "a", createdAt: day(10), tagged: false, protectedBy: false },
    { digest: "b", createdAt: day(10), tagged: false, protectedBy: true },
    { digest: "c", createdAt: day(10), tagged: true, protectedBy: false },
    { digest: "d", createdAt: day(1), tagged: false, protectedBy: false },
  ]
  assert.deepEqual(selectCleanup({ untaggedDays: 3 }, [], m, null, now).untagged, ["a"])
})

test("the same call is the preview and the run", () => {
  const a = selectCleanup({ keepLast: 1, notPulledDays: 1 }, tags, [], null, now)
  const b = selectCleanup({ keepLast: 1, notPulledDays: 1 }, tags, [], null, now)
  assert.deepEqual(a, b)
})
