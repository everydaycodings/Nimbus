import assert from "node:assert/strict"
import { test } from "node:test"

import type { Conflict } from "@nimbus/shared/api"

import { applyAnswers, askBeforeData, pendingConflicts, scanName, stripSummary, type Answers, type Entry, type UploadRow } from "./upload-plan.ts"

const folder: Conflict = { path: "Photos", kind: "folder", freeName: "Photos (1)" }
const inner: Conflict = { path: "Photos/a.jpg", kind: "file", freeName: "a (1).jpg" }
const loose: Conflict = { path: "b.pdf", kind: "file", freeName: "b (1).pdf" }
const entries: Entry[] = [
  { path: "Photos/a.jpg", size: 1, uri: "u1" },
  { path: "Photos/c.jpg", size: 1, uri: "u2" },
  { path: "b.pdf", size: 1, uri: "u3" },
]
const paths = (l: Entry[]) => l.map((e) => e.path)

test("folders are asked first, and a skipped or kept folder hides its files", () => {
  const all = [loose, inner, folder]
  assert.deepEqual(pendingConflicts(all, new Map()).map((c) => c.path), ["Photos", "b.pdf", "Photos/a.jpg"])
  for (const choice of ["skip", "keep"] as const)
    assert.deepEqual(pendingConflicts(all, new Map([["Photos", choice]])).map((c) => c.path), ["b.pdf"])
  assert.deepEqual(pendingConflicts(all, new Map([["Photos", "version"]])).map((c) => c.path), ["b.pdf", "Photos/a.jpg"])
})

test("skip drops the file, or everything in the folder", () => {
  const file = applyAnswers(entries, [loose], new Map([["b.pdf", "skip"]]))
  assert.deepEqual(paths(file.list), ["Photos/a.jpg", "Photos/c.jpg"])
  const dir = applyAnswers(entries, [folder, inner], new Map([["Photos", "skip"]]))
  assert.deepEqual(paths(dir.list), ["b.pdf"])
})

test("keep both on a folder moves its files under the free name, and leaves others", () => {
  const { list, versions } = applyAnswers(entries, [folder, inner], new Map([["Photos", "keep"]]))
  assert.deepEqual(paths(list), ["Photos (1)/a.jpg", "Photos (1)/c.jpg", "b.pdf"])
  assert.equal(versions.size, 0)
})

test("only an explicit New version becomes a version; keep both on a file is left to the server's rename", () => {
  const answers: Answers = new Map([["Photos", "version"], ["Photos/a.jpg", "version"], ["b.pdf", "keep"]])
  const { list, versions } = applyAnswers(entries, [folder, inner, loose], answers)
  assert.deepEqual(paths(list), paths(entries))
  assert.deepEqual([...versions], ["Photos/a.jpg"])
})

test("mobile data asks only over 100 MB", () => {
  const MB = 1024 * 1024
  assert.equal(askBeforeData(100 * MB, true), false)
  assert.equal(askBeforeData(100 * MB + 1, true), true)
  assert.equal(askBeforeData(500 * MB, false), false)
})

const row = (status: UploadRow["status"], sent = 0, size = 100): UploadRow => ({ id: status, accountId: "a", name: "n", mime: "", size, sent, status })

test("the strip says what most needs saying", () => {
  assert.equal(stripSummary([row("done", 100), row("uploading", 50), row("queued")]).text, "Uploading 2 of 3")
  assert.equal(stripSummary([row("waiting")]).text, "Waiting for Wi-Fi")
  assert.equal(stripSummary([row("paused"), row("done", 100)]).text, "Uploads paused")
  assert.equal(stripSummary([row("failed"), row("done", 100)]).text, "1 file couldn't upload")
  const ok = stripSummary([row("done", 100), row("done", 100)])
  assert.equal(ok.text, "Uploaded 2 files")
  assert.equal(ok.finished, true)
})

test("a duplicate keeps the strip up until someone decides", () => {
  const dup = { ...row("done", 100), duplicateOf: { id: "x", path: "a.jpg" } }
  const s = stripSummary([row("done", 100), dup])
  assert.equal(s.text, "1 file already in Nimbus")
  assert.equal(s.finished, false)
})

test("progress ignores refused files and counts finished ones in full", () => {
  assert.equal(stripSummary([row("done", 0), row("uploading", 50), row("refused")]).progress, 0.75)
  assert.equal(stripSummary([row("refused")]).failed, 1)
})

test("a scan is named by the local date and time, to the minute", () => {
  assert.equal(scanName("2026-11-07T14:32:05.123Z"), "Scan 2026-11-07 14.32.pdf")
  assert.equal(scanName("2026-01-02T00:05:00.000Z"), "Scan 2026-01-02 00.05.pdf")
})
