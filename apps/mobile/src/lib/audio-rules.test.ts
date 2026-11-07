// Run: node --test src/lib/audio-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { queueWindow, resumeAt } from "./audio-rules.ts"

test("resumes only from the middle of a track", () => {
  assert.equal(resumeAt(3, 200), 0)
  assert.equal(resumeAt(90, 200), 90)
  assert.equal(resumeAt(195, 200), 0)
  assert.equal(resumeAt(50, 0), 50)
  assert.equal(resumeAt(NaN, 200), 0)
})

test("the queue window follows the track and stays inside the folder", () => {
  assert.deepEqual(queueWindow(10, 3), { start: 0, end: 10 })
  assert.deepEqual(queueWindow(100, 0), { start: 0, end: 30 })
  assert.deepEqual(queueWindow(100, 50), { start: 45, end: 75 })
  assert.deepEqual(queueWindow(100, 99), { start: 94, end: 100 })
})
