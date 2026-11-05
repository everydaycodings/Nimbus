import assert from "node:assert/strict"
import { test } from "node:test"

import { CACHE_CAP, DATA_WARNING, evictions, needsDataWarning, planFor, toBase64 } from "./preview-rules.ts"

const MB = 1024 ** 2

test("native media stays native at any size", () => {
  assert.equal(planFor("a.jpg", "image/jpeg", 9e9).show, "image")
  assert.equal(planFor("a.mp4", "video/mp4", 9e9).show, "video")
  assert.equal(planFor("a.mp3", "audio/mpeg", 9e9).show, "audio")
})

test("office files stop at the web's limit, naming what they are", () => {
  assert.deepEqual(planFor("a.docx", null, 50 * MB), { show: "web", viewer: "docx", fetch: "cache", bytes: 50 * MB })
  assert.deepEqual(planFor("a.xlsx", null, 50 * MB + 1), { show: "none", reason: "This spreadsheet is too big to preview." })
  assert.deepEqual(planFor("a.pptx", null, 50 * MB + 1), { show: "none", reason: "This presentation is too big to preview." })
})

test("a PDF past the cache cap reads by range", () => {
  assert.deepEqual(planFor("a.pdf", null, CACHE_CAP), { show: "web", viewer: "pdf", fetch: "cache", bytes: CACHE_CAP })
  assert.deepEqual(planFor("a.pdf", null, CACHE_CAP + 1), { show: "web", viewer: "pdf", fetch: "range", bytes: CACHE_CAP + 1 })
})

test("long text and CSV fetch only what they show", () => {
  assert.deepEqual(planFor("a.log", null, 900 * MB), { show: "web", viewer: "text", fetch: "range", bytes: 2 * MB })
  assert.deepEqual(planFor("a.md", null, 1 * MB), { show: "web", viewer: "text", fetch: "cache", bytes: 1 * MB })
  assert.deepEqual(planFor("a.csv", null, 900 * MB), { show: "web", viewer: "sheet", fetch: "range", bytes: 10 * MB })
})

test("zip lists by range, and fetching its listing never warns", () => {
  const plan = planFor("a.zip", null, 900 * MB)
  assert.deepEqual(plan, { show: "web", viewer: "zip", fetch: "range", bytes: 0 })
  assert.equal(needsDataWarning(plan, true, false), false)
})

test("types only Collabora reads, and types nothing reads", () => {
  assert.equal(planFor("a.odt", null, 1).show, "collabora")
  assert.equal(planFor("a.doc", null, 1).show, "collabora")
  assert.equal(planFor("a.bin", null, 1).show, "none")
})

test("the data warning needs mobile data, a large fetch and no cached copy", () => {
  const big = planFor("a.pdf", null, DATA_WARNING + 1)
  assert.equal(needsDataWarning(big, true, false), true)
  assert.equal(needsDataWarning(big, false, false), false)
  assert.equal(needsDataWarning(big, true, true), false)
  assert.equal(needsDataWarning(planFor("a.pdf", null, DATA_WARNING), true, false), false)
  assert.equal(needsDataWarning(planFor("a.mp4", null, 9e9), true, false), false)
})

test("eviction removes the oldest until the rest fit", () => {
  const files = [
    { name: "new", size: 40, modified: 3 },
    { name: "old", size: 40, modified: 1 },
    { name: "mid", size: 40, modified: 2 },
  ]
  assert.deepEqual(evictions(files, 120), [])
  assert.deepEqual(evictions(files, 100).map((f) => f.name), ["old"])
  assert.deepEqual(evictions(files, 40).map((f) => f.name), ["old", "mid"])
  assert.deepEqual(evictions(files, 0).map((f) => f.name), ["old", "mid", "new"])
})

test("base64 matches the standard encoding at every padding length", () => {
  for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar"])
    assert.equal(toBase64(new TextEncoder().encode(s)), Buffer.from(s).toString("base64"))
  const big = Uint8Array.from({ length: 100_001 }, (_, i) => i * 7)
  assert.equal(toBase64(big), Buffer.from(big).toString("base64"))
})
