// Run: node --test lib/point-restore-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { earliestAfter, restoredName, undoable, type Hist } from "./point-restore-rules.ts"

const h = (nodeId: string, type: Hist["type"], at: number, fromName: string | null, fromParentId: string | null = null): Hist =>
  ({ nodeId, type, at, fromName, fromParentId })

test("the earliest rename and move after the time say what a node was", () => {
  const e = earliestAfter(
    [
      h("a", "rename", 30, "b"), // b -> c, later
      h("a", "rename", 20, "a"), // a -> b, first after T
      h("a", "rename", 5, "z"), // before T: ignored
      h("a", "move", 40, "c", "p2"),
      h("a", "move", 25, "b", "p1"),
      h("r", "move", 25, "r", null), // came from the root
    ],
    10
  )
  assert.equal(e.names.get("a"), "a")
  assert.equal(e.parents.get("a"), "p1")
  assert.equal(e.parents.get("r"), null)
  assert.ok(e.parents.has("r"))
  assert.equal(e.untracked.size, 0)
})

test("a first change from before the structured history can't be undone", () => {
  const e = earliestAfter([h("a", "rename", 20, null), h("a", "rename", 30, "x")], 10)
  assert.ok(e.untracked.has("a"))
  assert.ok(!e.names.has("a"))
})

test("clashes get (restored), then (restored 2), before the extension", () => {
  assert.equal(restoredName("a.txt", new Set(["a.txt"])), "a (restored).txt")
  assert.equal(restoredName("a.txt", new Set(["a (restored).txt"])), "a (restored 2).txt")
  assert.equal(restoredName("A.tar.gz", new Set()), "A.tar (restored).gz")
  assert.equal(restoredName("v1.2", new Set(), true), "v1.2 (restored)")
  assert.equal(restoredName(".env", new Set()), ".env (restored)")
})

test("undo lasts seven days and once", () => {
  const now = Date.now()
  assert.ok(undoable(now - 6 * 864e5, null, now))
  assert.ok(!undoable(now - 8 * 864e5, null, now))
  assert.ok(!undoable(now, new Date(), now))
})
