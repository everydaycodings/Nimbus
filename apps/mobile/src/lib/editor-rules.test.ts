import assert from "node:assert/strict"
import { test } from "node:test"

import { EDIT_MAX, canEdit, changedSince, commit, findAll, history, readOnly, redo, shown, undo } from "./editor-rules.ts"

test("text, Markdown and code are editable, other types are not", () => {
  for (const n of ["a.txt", "README.md", "main.ts", "config.yaml", "notes.json"]) assert.ok(canEdit(n, null), n)
  for (const n of ["a.pdf", "a.png", "a.docx", "a.zip", "a.csv"]) assert.ok(!canEdit(n, null), n)
})

test("1 MB is the last size that can be edited", () => {
  assert.ok(!readOnly(EDIT_MAX))
  assert.ok(readOnly(EDIT_MAX + 1))
})

test("undo and redo walk the snapshots; typing after undo drops the redo branch", () => {
  let h = history("a")
  h = commit(commit(h, "ab"), "abc")
  assert.equal(shown(undo(undo(h))), "a")
  assert.equal(shown(undo(undo(undo(h)))), "a")
  assert.equal(shown(redo(undo(h))), "abc")
  const forked = commit(undo(h), "abx")
  assert.equal(shown(redo(forked)), "abx")
  assert.equal(commit(h, "abc"), h)
})

test("history keeps the latest 100 snapshots", () => {
  let h = history("0")
  for (let i = 1; i <= 150; i++) h = commit(h, String(i))
  assert.equal(h.stack.length, 100)
  assert.equal(shown(h), "150")
})

test("find ignores case and doesn't overlap matches", () => {
  assert.deepEqual(findAll("Foo foo FOO", "foo"), [0, 4, 8])
  assert.deepEqual(findAll("aaaa", "aa"), [0, 2])
  assert.deepEqual(findAll("abc", ""), [])
})

test("a save is refused when the version moved on", () => {
  assert.ok(!changedSince("v1", "v1"))
  assert.ok(changedSince("v1", "v2"))
  assert.ok(changedSince("v1", null))
})
