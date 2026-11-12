import assert from "node:assert/strict"
import { test } from "node:test"

import { boxOf, boxQuery, pad, startView } from "./places-rules.ts"

test("the box wraps every point", () => {
  assert.deepEqual(boxOf([[10, 50], [12, 48], [11, 51]]), [10, 48, 12, 51])
})

test("a lone photo gets a view, not a box", () => {
  assert.deepEqual(startView([{ lat: 48.1, lng: 11.5 }]), { center: [11.5, 48.1], zoom: 10 })
  assert.deepEqual(startView([{ lat: 1, lng: 1 }, { lat: 2, lng: 3 }]), { bounds: [1, 1, 3, 2] })
  assert.deepEqual(startView([]), { center: [0, 20], zoom: 1 })
})

test("the query is west,south,east,north", () => {
  assert.equal(boxQuery(pad([1, 2, 3, 4], 0.5)), "0.500000,1.500000,3.500000,4.500000")
})
