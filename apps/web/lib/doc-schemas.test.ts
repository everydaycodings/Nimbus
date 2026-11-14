import assert from "node:assert/strict"
import { test } from "node:test"

import { Bulk, List, Patch, TypeBody } from "./doc-schemas.ts"
import { readFilters } from "./doc-filters.ts"

const id = "11111111-1111-4111-8111-111111111111"

test("documents input limits", () => {
  assert.equal(TypeBody.safeParse({ name: "x", remindDays: 2e9 }).success, false)
  assert.equal(TypeBody.safeParse({ name: "  ", remindDays: 3 }).success, false)
  assert.equal(Patch.safeParse({ remindDays: 3651 }).success, false)
  assert.equal(Patch.safeParse({ amount: 1e15 }).success, false)
  assert.equal(Patch.safeParse({ expiresAt: "2025-13-45" }).success, false)
  assert.equal(Patch.safeParse({ expiresAt: "2025-02-28", amount: 12.5 }).success, true)
  assert.equal(Bulk.safeParse({ ids: Array(501).fill(id) }).success, false)
  assert.equal(List.parse({ minAmount: "" }).minAmount, undefined)
  assert.equal(List.parse({ minAmount: "0" }).minAmount, 0)
  assert.equal(readFilters({ from: "2025-13-45" }).from, "")
})
