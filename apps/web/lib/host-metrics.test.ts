import assert from "node:assert/strict"
import { test } from "node:test"

import { guardVerdict, type HostMetrics } from "./host-metrics.ts"

const GB = 1024 ** 3
const m = (o: Partial<HostMetrics> = {}): HostMetrics => ({ memTotal: 16 * GB, memAvailable: 8 * GB, memUsedPct: 50, load1: 0.5, cores: 4, disk: [{ path: "/", total: 100 * GB, free: 50 * GB }], ...o })

test("healthy host passes", () => assert.deepEqual(guardVerdict(m(), { ramPct: 80, minDiskGb: 5, loadFactor: 1.5 }), { ok: true }))
test("RAM over the limit", () => {
  const v = guardVerdict(m({ memUsedPct: 93 }), { ramPct: 90, minDiskGb: 2 })
  assert.equal(v.ok, false)
  assert.equal(v.reason, "RAM 93%, limit 90%")
})
test("RAM exactly at the limit is fine", () => assert.equal(guardVerdict(m({ memUsedPct: 90 }), { ramPct: 90, minDiskGb: 2 }).ok, true))
test("low disk names the path", () => {
  const v = guardVerdict(m({ disk: [{ path: "/work", total: 10 * GB, free: 1 * GB }] }), { ramPct: 90, minDiskGb: 2 })
  assert.equal(v.ok, false)
  assert.match(v.reason!, /\/work/)
})
test("load only counts with a factor", () => {
  assert.equal(guardVerdict(m({ load1: 9 }), { ramPct: 90, minDiskGb: 2 }).ok, true)
  assert.equal(guardVerdict(m({ load1: 9 }), { ramPct: 90, minDiskGb: 2, loadFactor: 1.5 }).ok, false)
})
