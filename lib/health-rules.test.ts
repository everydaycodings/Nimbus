// Run: node --test lib/health-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  alertOf,
  buckets,
  incidents,
  outcomeOf,
  statusOf,
  uptime,
  type Outcome,
} from "./health-rules.ts"

test("a failure is degraded until it repeats", () => {
  assert.equal(statusOf(["fail", "ok"], 2), "degraded")
  assert.equal(statusOf(["fail", "fail", "ok"], 2), "down")
  assert.equal(statusOf(["fail"], 1), "down")
  assert.equal(statusOf(["slow", "fail"], 2), "degraded")
  assert.equal(statusOf(["ok", "fail", "fail"], 2), "ok")
  assert.equal(statusOf(["off", "fail"], 2), "off")
  assert.equal(statusOf([], 2), "off")
})

test("alerts fire once going down and once coming back", () => {
  const seq: Outcome[] = ["ok", "fail", "fail", "fail", "ok", "ok"]
  const fired = seq.map((_, i) => alertOf(seq.slice(0, i + 1).reverse(), 2))
  assert.deepEqual(fired, [null, null, "down", null, "up", null])
  // A blip that never reached the threshold recovers quietly.
  assert.equal(alertOf(["ok", "fail"], 2), null)
  // Turning a down service off doesn't claim it recovered.
  assert.equal(alertOf(["off", "fail", "fail"], 2), null)
})

test("slow only past the threshold", () => {
  assert.equal(outcomeOf(false, 300, 250), "slow")
  assert.equal(outcomeOf(false, 300, undefined), "ok")
  assert.equal(outcomeOf(true, 1, 250), "fail")
})

test("buckets keep the worst outcome and leave gaps empty", () => {
  const rows = [
    { outcome: "ok" as const, at: 0 },
    { outcome: "fail" as const, at: 5 },
    { outcome: "slow" as const, at: 25 },
    { outcome: "ok" as const, at: 99 },
    { outcome: "fail" as const, at: 100 },
  ]
  assert.deepEqual(buckets(rows, 0, 100, 4), ["fail", "slow", null, "ok"])
})

test("uptime ignores checks that didn't run", () => {
  assert.equal(uptime(["ok", "slow", "fail", "off"]), 2 / 3)
  assert.equal(uptime(["off"]), null)
})

test("incidents are runs of failures, newest first", () => {
  const rows = (["ok", "fail", "fail", "ok", "fail"] as const).map(
    (outcome, at) => ({ outcome, at })
  )
  assert.deepEqual(
    incidents(rows).map((i) => [i.first.at, i.end]),
    [
      [4, null],
      [1, 3],
    ]
  )
})
