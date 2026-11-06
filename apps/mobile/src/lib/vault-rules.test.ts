import assert from "node:assert/strict"
import { test } from "node:test"

import { awayExpired, filtered, idleExpired, foldersNeeded, kidsOf, nameError, pathTo, plainSize, planClashes, renameKept, sorted, trashRoots, withPaths, type VaultEntry } from "./vault-rules.ts"

const e = (id: string, name: string, parentId: string | null, kind: "file" | "folder" = "file", trashedAt: string | null = null): VaultEntry => ({
  id, parentId, kind, name, mime: null, size: 1, updatedAt: "2026-01-01", trashedAt, encKey: null,
})
const tree = [e("d", "Docs", null, "folder"), e("a", "a.txt", "d"), e("b", "B.txt", null), e("t1", "old", null, "folder", "T"), e("t2", "x", "t1", "file", "T")]

test("plain size drops 16 bytes per chunk", () => {
  assert.equal(plainSize(16), 0)
  assert.equal(plainSize(116), 100)
  assert.equal(plainSize(4 * 1024 * 1024 + 16 + 17), 4 * 1024 * 1024 + 1)
})

test("listing: live kids, trash tops, folders first, filter looks everywhere", () => {
  assert.deepEqual(kidsOf(tree, null).map((x) => x.id), ["d", "b"])
  assert.deepEqual(trashRoots(tree).map((x) => x.id), ["t1"])
  assert.deepEqual(sorted(kidsOf(tree, null), "name", "asc").map((x) => x.id), ["d", "b"])
  assert.deepEqual(filtered(tree.filter((x) => !x.trashedAt), " A.TXT").map((x) => x.id), ["a"])
  assert.deepEqual(pathTo(tree, "a").map((x) => x.id), ["d", "a"])
  assert.deepEqual(pathTo(tree, "d").map((x) => x.id), ["d"])
})

test("names are checked like the web", () => {
  assert.equal(nameError("  ", []), "Enter a name.")
  assert.match(nameError("a/b", [])!, /contain/)
  assert.match(nameError("B.TXT", kidsOf(tree, null))!, /already/)
  assert.equal(nameError("b.txt", kidsOf(tree, null), "b"), null)
})

test("paths for ZIP and Move out", () => {
  assert.deepEqual(withPaths(tree, [tree[0]]).map((x) => x.path), ["Docs", "Docs/a.txt"])
})

test("clashes: same kind asks, other kind is renamed, inner files are found", () => {
  const send = [{ path: "b.txt", uri: "u" }, { path: "Docs", uri: undefined }, { path: "Docs/a.txt", uri: "u2" }, { path: "Docs/new.txt", uri: "u3" }]
  const { conflicts, existing } = planClashes(tree, null, send)
  assert.deepEqual(conflicts.map((c) => [c.path, c.kind, c.freeName]), [["b.txt", "file", "b (1).txt"], ["Docs", "folder", "Docs (1)"], ["Docs/a.txt", "file", "a (1).txt"]])
  assert.equal(existing.get("Docs/a.txt"), "a")
  const swapped = planClashes(tree, null, [{ path: "Docs", uri: "u" }])
  assert.equal(swapped.conflicts.length, 0)
  assert.equal(swapped.list[0].path, "Docs (1)")
})

test("keep both renames the file", () => {
  const out = renameKept([{ path: "Docs/a.txt", uri: "u" }], [{ path: "Docs/a.txt", kind: "file", freeName: "a (1).txt" }], new Map([["Docs/a.txt", "keep"]]))
  assert.equal(out[0].path, "Docs/a (1).txt")
})

test("folders needed: existing reused, missing made parents first", () => {
  const { ids, make } = foldersNeeded(tree, null, [{ path: "Docs/sub/f.txt", uri: "u" }, { path: "Empty" }])
  assert.equal(ids.get("Docs"), "d")
  assert.deepEqual(make, [{ key: "Empty", parent: null, name: "Empty" }, { key: "Docs/sub", parent: "d", name: "sub" }])
})

test("lock timing: 30 s away, or idle minutes", () => {
  assert.equal(awayExpired(100_000, 0), false)
  assert.equal(awayExpired(100_000, 70_001), false)
  assert.equal(awayExpired(100_000, 70_000), true)
  assert.equal(idleExpired(15 * 60_000, 0, 15), false)
  assert.equal(idleExpired(15 * 60_000 + 1, 0, 15), true)
})
