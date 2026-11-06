import assert from "node:assert/strict"
import { test } from "node:test"

import { canQueue, capCheck, classify, clashName, idsOf, newTempId, planRefresh, remap, renamed, unresolved, type Op } from "./offline-rules.ts"

test("only the plain edits can wait for a connection", () => {
  for (const op of ["rename", "move", "star", "trash", "restore", "newFolder", "applyTag"]) assert.ok(canQueue(op), op)
  for (const op of ["share", "link", "version", "delete", "emptyTrash", "password"]) assert.ok(!canQueue(op), op)
})

test("errors map to retry, rename or fail", () => {
  const rename: Op = { op: "rename", id: "a", name: "x.pdf" }
  const star: Op = { op: "star", ids: ["a"], starred: true }
  assert.equal(classify(star, { status: 0 }), "retry")
  assert.equal(classify(star, { status: 503 }), "retry")
  assert.equal(classify(star, { status: 429 }), "retry")
  assert.equal(classify(star, { status: 404 }), "fail")
  assert.equal(classify(star, { status: 401 }), "fail")
  const clash = { status: 400, message: "Something with that name is already in this folder." }
  assert.equal(classify(rename, clash), "rename")
  assert.equal(classify({ op: "newFolder", parentId: null, name: "A", tempId: "temp-1" }, clash), "rename")
  assert.equal(classify({ ...rename, clashed: true }, clash), "fail")
  assert.equal(classify({ op: "move", ids: ["a"], parentId: "b" }, clash), "fail")
  assert.equal(classify(rename, { status: 400, message: "Names can't be empty." }), "fail")
})

test("a name clash retries as name (1), before the extension", () => {
  assert.equal(clashName("report.pdf"), "report (1).pdf")
  assert.equal(clashName("archive.tar.gz"), "archive.tar (1).gz")
  assert.equal(clashName(".env"), ".env (1)")
  assert.equal(clashName("Photos"), "Photos (1)")
  assert.equal(clashName("v1.2", true), "v1.2 (1)")
  const r = renamed({ op: "rename", id: "a", name: "a.txt" })
  assert.deepEqual(r, { op: "rename", id: "a", name: "a (1).txt", clashed: true })
})

test("cap math: over only when the total passes the cap, and no limit never does", () => {
  assert.deepEqual(capCheck(4, 1, 5), { over: false, total: 5, short: 0 })
  assert.deepEqual(capCheck(4, 2, 5), { over: true, total: 6, short: 1 })
  assert.equal(capCheck(1e15, 1e15, null).over, false)
})

test("a refresh downloads changed files, drops gone ones, and leaves out what the cap can't hold", () => {
  const known = [
    { id: "a", version: "1" },
    { id: "b", version: "1" },
    { id: "gone", version: "1" },
  ]
  const listed = [
    { id: "a", version: "1", size: 10 },
    { id: "b", version: "2", size: 10 },
    { id: "c", version: "1", size: 10 },
    { id: "d", version: "1", size: 50 },
  ]
  const p = planRefresh(known, listed, 25)
  assert.deepEqual(p.download.map((f) => f.id), ["b", "c"])
  assert.deepEqual(p.skipped.map((f) => f.id), ["d"])
  assert.deepEqual(p.remove.map((f) => f.id), ["gone"])
  assert.equal(planRefresh(known, listed, null).download.length, 3)
})

test("moves into a folder made offline get its real id, and fail if it was never made", () => {
  const temp = newTempId()
  const move: Op = { op: "move", ids: ["x", temp], parentId: temp }
  assert.deepEqual(idsOf(move), ["x", temp, temp])
  assert.ok(unresolved(move, {}))
  const real = { [temp]: "real-1" }
  assert.ok(!unresolved(move, real))
  assert.deepEqual(remap(move, real), { op: "move", ids: ["x", "real-1"], parentId: "real-1" })
  assert.deepEqual(remap({ op: "newFolder", parentId: temp, name: "n", tempId: "temp-z" }, real), { op: "newFolder", parentId: "real-1", name: "n", tempId: "temp-z" })
  assert.deepEqual(remap({ op: "star", ids: [temp], starred: true }, real), { op: "star", ids: ["real-1"], starred: true })
  // Its own temporary id is the creation, not a dependency.
  assert.ok(!unresolved({ op: "newFolder", parentId: null, name: "n", tempId: temp }, {}))
})
