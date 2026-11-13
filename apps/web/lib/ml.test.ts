import assert from "node:assert/strict"
import { test } from "node:test"

import { buildSrt, buildTxt, buildVtt, clusterFaces, faceVerdict, mixHits, segLines } from "./ml.ts"

const lines = segLines([
  { start: 0.5, end: 2.25, text: " Hello there " },
  { start: 3725.1, end: 3727, text: "Later" },
  { start: 4000, end: 4001, text: "  " },
])

test("segments become trimmed lines, empty ones dropped", () => {
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], { tMs: 500, endMs: 2250, body: "Hello there" })
})

test("VTT and SRT stamps", () => {
  assert.equal(buildVtt(lines), "WEBVTT\n\n00:00:00.500 --> 00:00:02.250\nHello there\n\n01:02:05.100 --> 01:02:07.000\nLater\n")
  assert.ok(buildSrt(lines).startsWith("1\n00:00:00,500 --> 00:00:02,250\nHello there\n\n2\n01:02:05,100"))
  assert.equal(buildTxt(lines), "Hello there\nLater\n")
})

test("a line with no end lasts until the next one", () => {
  const vtt = buildVtt([{ tMs: 1000, endMs: null, body: "a" }, { tMs: 3000, endMs: null, body: "b" }])
  assert.ok(vtt.includes("00:00:01.000 --> 00:00:03.000"))
  assert.ok(vtt.includes("00:00:03.000 --> 00:00:07.000"))
})

test("mixing: text first, then people, then pictures, each file once", () => {
  const h = (id: string) => ({ id })
  const out = mixHits([h("a"), h("b")], [h("b"), h("c")], [h("a"), h("c"), h("d")], 4)
  assert.deepEqual(out, [{ id: "a" }, { id: "b" }, { id: "c", match: "person" }, { id: "d", match: "picture" }])
  assert.equal(mixHits([h("a"), h("b")], [], [], 1).length, 1)
})

test("face clustering joins chains and drops small groups", () => {
  const ids = ["1", "2", "3", "4", "5", "6"]
  const groups = clusterFaces(ids, [["1", "2"], ["2", "3"], ["4", "5"]], 3)
  assert.deepEqual(groups.map((g) => g.sort()), [["1", "2", "3"]])
})

test("one person is never twice in the same photo", () => {
  // 1 and 3 are in photo A; the chain 1-2-3 must not join them.
  const photo = new Map([["1", "A"], ["2", "B"], ["3", "A"], ["4", "C"]])
  const groups = clusterFaces(["1", "2", "3", "4"], [["1", "2"], ["2", "3"], ["2", "4"]], 3, photo)
  assert.deepEqual(groups.map((g) => g.sort()), [["1", "2", "4"]])
})

test("face verdict thresholds", () => {
  assert.equal(faceVerdict(0.3), "join")
  assert.equal(faceVerdict(0.5), "suggest")
  assert.equal(faceVerdict(0.9), "none")
  assert.equal(faceVerdict(null), "none")
})
