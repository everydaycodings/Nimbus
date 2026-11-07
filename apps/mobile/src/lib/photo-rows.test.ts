// Run: node --test src/lib/photo-rows.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import type { PhotoItem } from "@nimbus/shared/api"

import { photoRows } from "./photo-rows.ts"

const photo = (id: string, day: string) => ({ id, takenAt: new Date(`${day}T12:00:00`).toISOString() }) as PhotoItem

test("a header per month, then full rows with the global index of each row's first photo", () => {
  const items = [photo("a", "2024-05-20"), photo("b", "2024-05-10"), photo("c", "2024-05-02"), photo("d", "2024-04-01")]
  const rows = photoRows(items, 2, new Date(2026, 0, 1))
  assert.deepEqual(
    rows.map((r) => (r.type === "month" ? r.title : `${r.start}:${r.items.map((i) => i.id).join("")}`)),
    ["May 2024", "0:ab", "2:c", "April 2024", "3:d"]
  )
})

test("no photos, no rows", () => assert.deepEqual(photoRows([], 3), []))
