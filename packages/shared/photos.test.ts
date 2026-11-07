// Run: node --test packages/shared/photos.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { groupByMonth, monthKey, monthTitle, parsePhotoCursor, photoCursor } from "./photos.ts"

const id = "11111111-2222-3333-4444-555555555555"

test("groups neighbours by month and splits when the month comes back", () => {
  const at = (s: string) => ({ takenAt: new Date(s + "T12:00:00").toISOString() })
  const g = groupByMonth([at("2024-05-20"), at("2024-05-02"), at("2024-04-30"), at("2024-05-01")])
  assert.deepEqual(g.map((x) => [x.key, x.items.length]), [["2024-05", 2], ["2024-04", 1], ["2024-05", 1]])
  assert.equal(monthKey(at("2024-01-15").takenAt), "2024-01")
})

test("month titles drop the year only for this year", () => {
  const now = new Date(2026, 10, 7)
  assert.equal(monthTitle("2026-03", now), "March")
  assert.equal(monthTitle("2024-05", now), "May 2024")
})

test("cursor round-trips and rejects junk", () => {
  const iso = "2024-05-17T14:03:09.123Z"
  assert.deepEqual(parsePhotoCursor(photoCursor(iso, id)), { ms: Date.parse(iso), id })
  assert.equal(parsePhotoCursor("12"), null)
  assert.equal(parsePhotoCursor(undefined), null)
})
