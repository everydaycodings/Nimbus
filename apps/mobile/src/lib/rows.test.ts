import assert from "node:assert/strict"
import { test } from "node:test"

import type { Item } from "@nimbus/shared/api"

import { columnsFor, toRows } from "./rows.ts"

const item = (id: string, kind: Item["kind"]) => ({ id, kind }) as Item
const mixed = [item("f1", "file"), item("d1", "folder"), item("f2", "file"), item("f3", "file")]

test("grid puts folders first under headers and chunks to the column count", () => {
  const rows = toRows(mixed, 2, "grid")
  assert.deepEqual(rows.map((r) => r.key), ["h-folders", "folders-d1", "h-files", "files-f1", "files-f3"])
  const first = rows[3]
  assert.ok(first.type === "files")
  assert.deepEqual(first.items.map((i) => i.id), ["f1", "f2"])
})

test("grid leaves out a section with nothing in it", () => {
  assert.deepEqual(toRows([item("f1", "file")], 2, "grid").map((r) => r.key), ["h-files", "files-f1"])
  assert.deepEqual(toRows([], 2, "grid"), [])
})

test("list keeps the server's order, with no headers", () => {
  assert.deepEqual(toRows(mixed, 2, "list").map((r) => r.key), ["f1", "d1", "f2", "f3"])
})

test("tile sizes give 3, 2 and 1 columns on a phone, and more on a tablet", () => {
  assert.deepEqual([columnsFor(412, "small"), columnsFor(412, "medium"), columnsFor(412, "large")], [3, 2, 1])
  assert.deepEqual([columnsFor(360, "small"), columnsFor(360, "medium"), columnsFor(360, "large")], [3, 2, 1])
  assert.ok(columnsFor(800, "medium") >= 4)
})

test("pinSystem puts system folders first in both layouts", () => {
  const sys = { id: "s1", kind: "folder", system: "camera" } as Item
  const all = [item("d1", "folder"), item("f1", "file"), sys]
  assert.deepEqual(toRows(all, 2, "list", true).map((r) => r.key), ["s1", "d1", "f1"])
  assert.deepEqual(toRows(all, 2, "grid", true).slice(0, 2).map((r) => r.key), ["h-folders", "folders-s1"])
  assert.deepEqual(toRows(all, 2, "list").map((r) => r.key), ["d1", "f1", "s1"])
})
