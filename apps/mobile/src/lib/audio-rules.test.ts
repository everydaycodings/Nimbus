// Run: node --test src/lib/audio-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { queueWindow } from "./audio-rules.ts"

test("the queue window follows the track and stays inside the folder", () => {
  assert.deepEqual(queueWindow(10, 3), { start: 0, end: 10 })
  assert.deepEqual(queueWindow(100, 0), { start: 0, end: 30 })
  assert.deepEqual(queueWindow(100, 50), { start: 45, end: 75 })
  assert.deepEqual(queueWindow(100, 99), { start: 94, end: 100 })
})
