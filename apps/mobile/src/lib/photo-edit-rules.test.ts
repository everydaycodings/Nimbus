import assert from "node:assert/strict"
import { test } from "node:test"

import { START, canEditPhoto, cropBox, flatSize, outFormat, same } from "./photo-edit-rules.ts"

test("JPEG, PNG and WebP can be edited; HEIC, GIF, SVG and nothing cannot", () => {
  for (const m of ["image/jpeg", "image/png", "image/webp"]) assert.ok(canEditPhoto(m), m)
  for (const m of ["image/heic", "image/gif", "image/svg+xml", "video/mp4", null]) assert.ok(!canEditPhoto(m), String(m))
  assert.deepEqual(["image/png", "image/webp", "image/jpeg", null].map(outFormat), ["png", "webp", "jpeg", "jpeg"])
})

test("cropBox: no tilt and a full crop is the whole picture; a crop box sits inside it", () => {
  assert.deepEqual(cropBox(400, 300, 400, 300, START), { originX: 0, originY: 0, width: 400, height: 300 })
  const half = { ...START, crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } }
  assert.deepEqual(cropBox(400, 300, 400, 300, half), { originX: 100, originY: 150, width: 200, height: 150 })
})

test("cropBox: a tilted picture is cut from the middle of the larger canvas and never leaves it", () => {
  const g = { ...START, angle: 10 }
  const a = (10 * Math.PI) / 180
  const ew = Math.ceil(400 * Math.cos(a) + 300 * Math.sin(a))
  const eh = Math.ceil(400 * Math.sin(a) + 300 * Math.cos(a))
  const b = cropBox(400, 300, ew, eh, g)
  assert.ok(b.width < 400 && b.height < 300)
  assert.ok(b.originX > 0 && b.originY > 0 && b.originX + b.width <= ew && b.originY + b.height <= eh)
  assert.ok(Math.abs(b.originX * 2 + b.width - ew) <= 2 && Math.abs(b.originY * 2 + b.height - eh) <= 2)
})

test("flatSize caps the long side and keeps the shape", () => {
  assert.deepEqual(flatSize(1000, 500), { width: 1000, height: 500 })
  assert.deepEqual(flatSize(8192, 4096), { width: 4096, height: 2048 })
})

test("same compares edits by value", () => {
  assert.ok(same(START, { ...START }))
  assert.ok(!same(START, { ...START, flip: true }))
})
