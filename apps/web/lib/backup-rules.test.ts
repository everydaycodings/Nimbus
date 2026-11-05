// Run: node --test lib/backup-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  diffFingerprints,
  isStale,
  judgeRestore,
  monthlyCents,
  nextRun,
  pickSample,
  restoreErrors,
  runHours,
  scrub,
  selectToDelete,
  shrank,
  toCron,
  type Fingerprint,
  type Retained,
  type Schedule,
} from "./backup-rules.ts"

const sched = (s: Partial<Schedule> = {}): Schedule => ({
  enabled: true,
  intervalHours: 6,
  start: "03:30",
  tz: "Asia/Kolkata",
  paused: false,
  ...s,
})

test("runs land at the same local times every day", () => {
  assert.deepEqual(runHours(6, "03:30"), [3, 9, 15, 21])
  assert.deepEqual(runHours(8, "20:00"), [4, 12, 20])
  assert.equal(toCron(6, "03:30"), "30 3,9,15,21 * * *")
  assert.equal(toCron(24, "00:05"), "5 0 * * *")
})

test("next run is in the schedule's zone", () => {
  // 2026-10-19 04:00 IST = 22:30 UTC the day before.
  const now = new Date("2026-10-18T22:30:00Z")
  // Next is 09:30 IST = 04:00 UTC.
  assert.equal(
    nextRun(sched(), now)?.toISOString(),
    "2026-10-19T04:00:00.000Z"
  )
  assert.equal(nextRun(sched({ paused: true }), now), null)
  assert.equal(nextRun(sched({ enabled: false }), now), null)
})

test("next run follows daylight saving", () => {
  // New York leaves DST on 2026-11-01; 02:00 local is 07:00 UTC after it.
  const s = sched({ intervalHours: 24, start: "02:00", tz: "America/New_York" })
  assert.equal(
    nextRun(s, new Date("2026-11-01T12:00:00Z"))?.toISOString(),
    "2026-11-02T07:00:00.000Z"
  )
})

test("stale after twice the interval without a good backup", () => {
  const now = new Date("2026-10-19T12:00:00Z")
  const at = (h: number) => new Date(now.getTime() - h * 3600_000)
  assert.equal(isStale(sched(), at(11), now), false)
  assert.equal(isStale(sched(), at(13), now), true)
  assert.equal(isStale(sched(), null, now), false)
  assert.equal(isStale(sched({ paused: true }), at(13), now), false)
})

const now = new Date("2026-10-19T12:00:00Z")
const file = (
  id: string,
  hoursAgo: number,
  status: Retained["status"] = "ok",
  pinned = false
): Retained => ({
  id,
  at: new Date(now.getTime() - hoursAgo * 3600_000),
  status,
  pinned,
})

test("last_n keeps the newest N, pinned and recent failures", () => {
  const files = [
    file("a", 1),
    file("b", 2),
    file("c", 3),
    file("d", 4, "ok", true),
    file("e", 5, "failed"),
    file("f", 24 * 8, "failed"),
  ]
  assert.deepEqual(
    selectToDelete(files, { mode: "last_n", keepLast: 2 }, now).sort(),
    ["c", "f"]
  )
})

test("the newest good backup survives any setting", () => {
  const files = [file("a", 1, "failed"), file("b", 100)]
  assert.deepEqual(selectToDelete(files, { mode: "last_n", keepLast: 0 }, now), [])
})

test("tiered keeps all recent, then one per day", () => {
  const files = [
    file("a", 1),
    file("b", 30),
    file("c", 31),
    file("d", 24 * 3),
    file("e", 24 * 40),
  ]
  const r = { mode: "tiered", hours: 24, days: 7, weeks: 0, months: 0 } as const
  assert.deepEqual(selectToDelete(files, r, now).sort(), ["c", "e"])
})

const fp = (f: Partial<Fingerprint> = {}): Fingerprint => ({
  tables: { "public.nodes": { rows: 3, checksum: "abc123ff" } },
  objects: { "public.indexes": 4 },
  sequences: { "public.seq": "10" },
  ...f,
})

test("a matching copy has no diffs; a sequence may run ahead", () => {
  assert.deepEqual(diffFingerprints(fp(), fp()), [])
  assert.deepEqual(
    diffFingerprints(fp(), fp({ sequences: { "public.seq": "12" } })),
    []
  )
})

test("changed rows, objects and a lagging sequence are diffs", () => {
  const d = diffFingerprints(
    fp(),
    fp({
      tables: { "public.nodes": { rows: 3, checksum: "zzz" } },
      objects: {},
      sequences: { "public.seq": "9" },
    })
  )
  assert.deepEqual(
    d.map((x) => x.kind),
    ["table", "object", "sequence"]
  )
  assert.equal(diffFingerprints(fp(), fp({ tables: {} }))[0].restored, null)
})

test("only the listed restore errors are harmless", () => {
  const { harmless, fatal } = restoreErrors(
    [
      "pg_restore: error: could not execute query: ERROR:  schema \"public\" already exists",
      "pg_restore: error: could not execute query: ERROR:  relation x does not exist",
      "Command was: CREATE TABLE x",
      "pg_restore: warning: errors ignored on restore: 2",
    ].join("\n")
  )
  assert.equal(harmless.length, 1)
  assert.equal(fatal.length, 1)
  assert.match(fatal[0], /Command was/)
})

test("a big shrink is flagged", () => {
  assert.equal(shrank(70, 100, 20), 30)
  assert.equal(shrank(90, 100, 20), null)
  assert.equal(shrank(10, null, 20), null)
  assert.equal(shrank(10, 100, null), null)
})

test("sample picks distinct keys, at least the minimum", () => {
  const keys = Array.from({ length: 1000 }, (_, i) => i)
  const s = pickSample(keys, 1, 50)
  assert.equal(s.length, 50)
  assert.equal(new Set(s).size, 50)
  assert.equal(pickSample([1, 2], 1, 50).length, 2)
  assert.equal(pickSample(keys, 10, 5).length, 100)
})

test("scrub hides connection strings", () => {
  assert.equal(
    scrub("failed: postgres://u:p@h/db nope"),
    "failed: postgres://… nope"
  )
})

test("cost estimate rounds up, unknown providers are null", () => {
  assert.equal(monthlyCents("aws", 10e9), 23)
  assert.equal(monthlyCents("aws", 1), 1)
  assert.equal(monthlyCents("minio", 10e9), null)
})

test("a clean restore passes; any other error fails", () => {
  const ok = judgeRestore(fp(), fp(), []).checks
  assert.equal(ok.restore?.ok && ok.schema?.ok && ok.integrity?.ok, true)
  const bad = judgeRestore(fp(), fp(), ["relation x does not exist"])
  assert.equal(bad.checks.restore?.ok, false)
})

test("orphan rows breaking a foreign key are a warning, not a failure", () => {
  const live = fp({ objects: { "public.constraints_f": 3 } })
  const restored = fp({ objects: { "public.constraints_f": 2 } })
  const err =
    'could not execute query: ERROR:  insert or update on table "nodes" violates foreign key constraint "nodes_owner_fk"'
  const r = judgeRestore(live, restored, [err])
  assert.equal(r.checks.restore?.ok, true)
  assert.equal(r.checks.integrity?.ok, false)
  assert.equal(r.diffs[0].kind, "constraint")
  // A table that also differs makes it a real failure.
  const worse = judgeRestore(live, { ...restored, tables: {} }, [err])
  assert.equal(worse.checks.restore?.ok, false)
})

test("scrub hides row values", () => {
  assert.equal(
    scrub("Key (email)=(a@b.c) already exists"),
    "Key (email)=(…) already exists"
  )
})
