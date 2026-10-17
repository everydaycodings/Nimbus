// Run: node --test lib/preview-parsers.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { coverArt } from "./cover-art.ts"
import { parseCsv } from "./csv.ts"

const bytes = (...parts: (string | number[] | Uint8Array)[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : [...p]
    )
  )
const be32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const safe = (n: number) => [
  (n >> 21) & 127,
  (n >> 14) & 127,
  (n >> 7) & 127,
  n & 127,
]
const reader = (b: Uint8Array) => async (s: number, e: number) => b.slice(s, e)
const IMG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]

test("ID3v2.4 picks the front cover", async () => {
  const frame = (type: number, img: number[]) => {
    const body = bytes([0], "image/jpeg", [0, type], "desc", [0], img)
    return bytes("APIC", safe(body.length), [0, 0], body)
  }
  const frames = bytes(frame(0, [9, 9]), frame(3, IMG))
  const file = bytes(
    "ID3",
    [4, 0, 0],
    safe(frames.length),
    frames,
    [0xff, 0xfb]
  )
  const pic = await coverArt(reader(file), file.length)
  assert.equal(pic?.type, "image/jpeg")
  assert.deepEqual([...pic!.data], IMG)
})

test("ID3v2.3 with a UTF-16 description", async () => {
  const body = bytes([1], "png", [0, 3], [0xff, 0xfe, 65, 0, 0, 0], IMG)
  const frames = bytes("APIC", be32(body.length), [0, 0], body)
  const file = bytes("ID3", [3, 0, 0], safe(frames.length), frames)
  const pic = await coverArt(reader(file), file.length)
  assert.equal(pic?.type, "image/png")
  assert.deepEqual([...pic!.data], IMG)
})

test("MP4 covr atom", async () => {
  const box = (name: string, ...kids: Uint8Array[]) => {
    const body = bytes(...kids)
    return bytes(be32(body.length + 8), name, body)
  }
  const data = box("data", bytes(be32(14), be32(0), IMG))
  const meta = box(
    "meta",
    bytes([0, 0, 0, 0]),
    box("hdlr", bytes([1, 2])),
    box("ilst", box("covr", data))
  )
  const file = bytes(
    box("ftyp", bytes("M4A ")),
    box("mdat", bytes([7, 7, 7])),
    box("moov", box("udta", meta))
  )
  const pic = await coverArt(reader(file), file.length)
  assert.equal(pic?.type, "image/png")
  assert.deepEqual([...pic!.data], IMG)
})

test("no art", async () => {
  const file = bytes([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(await coverArt(reader(file), file.length), null)
})

test("parseCsv handles quotes, CRLF and limits", () => {
  assert.deepEqual(parseCsv('a,"b,""c"""\r\n1,\n"x\ny",z'), [
    ["a", 'b,"c"'],
    ["1", ""],
    ["x\ny", "z"],
  ])
  assert.deepEqual(parseCsv("a\tb\n1\t2\n", "\t"), [
    ["a", "b"],
    ["1", "2"],
  ])
  assert.deepEqual(parseCsv("1\n2\n3", ",", 2), [["1"], ["2"]])
})
