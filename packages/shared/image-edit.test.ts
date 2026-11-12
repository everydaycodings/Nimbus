// Run: node --test packages/shared/image-edit.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { dragCrop, fitAspect, innerSize } from "./image-edit.ts"

const close = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)

// The inner box's corners must lie inside the rotated picture.
function inside(w: number, h: number, deg: number, iw: number, ih: number) {
  const a = (deg * Math.PI) / 180
  for (const [x, y] of [[iw / 2, ih / 2], [-iw / 2, ih / 2], [iw / 2, -ih / 2], [-iw / 2, -ih / 2]]) {
    // back into the picture's own axes
    const u = x * Math.cos(a) + y * Math.sin(a)
    const v = -x * Math.sin(a) + y * Math.cos(a)
    assert.ok(Math.abs(u) <= w / 2 + 1e-6 && Math.abs(v) <= h / 2 + 1e-6, `corner out at ${deg}`)
  }
}

test("innerSize: no rotation keeps the picture; rotated boxes fit and touch the edge", () => {
  assert.deepEqual(innerSize(400, 300, 0), { w: 400, h: 300 })
  for (const [w, h] of [[400, 300], [300, 400], [500, 500], [1000, 100]])
    for (const deg of [1, 5, 15, 30, 45, -20]) {
      const r = innerSize(w, h, deg)
      assert.ok(r.w > 0 && r.h > 0 && r.w <= w && r.h <= h)
      inside(w, h, Math.abs(deg), r.w, r.h)
    }
  const sq = innerSize(100, 100, 45)
  close(sq.w, 100 / Math.SQRT2) // a 100 square turned 45 degrees holds a 70.7 square
})

test("fitAspect: centred, as large as it can be", () => {
  const r = fitAspect(1, 4 / 3) // square in a 4:3 picture
  close(r.h, 1)
  close(r.w, 0.75)
  close(r.x, 0.125)
  const wide = fitAspect(16 / 9, 4 / 3)
  close(wide.w, 1)
  close(wide.h, (4 / 3) / (16 / 9))
})

test("dragCrop: move stays inside, free edges keep a minimum, locked corners keep the aspect", () => {
  const box = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }
  assert.deepEqual(dragCrop(box, "move", 1, -1, 1, null), { x: 0.5, y: 0, w: 0.5, h: 0.5 })
  const e = dragCrop(box, "e", -5, 0, 1, null)
  close(e.w, 0.08)
  const nw = dragCrop(box, "nw", -0.1, -0.05, 1, null)
  close(nw.x, 0.1)
  close(nw.y, 0.15)
  close(nw.x + nw.w, 0.7)
  const ratio = 1.5
  const start = fitAspect(1, ratio)
  const grown = dragCrop({ ...start, w: start.w / 2, h: start.h / 2, x: 0.1, y: 0.1 }, "se", 0.2, 0, ratio, 1)
  close((grown.w * ratio) / grown.h, 1)
  const capped = dragCrop(box, "se", 5, 5, 1, 1)
  assert.ok(capped.x + capped.w <= 1 + 1e-9 && capped.y + capped.h <= 1 + 1e-9)
  close(capped.w, capped.h)
  const m = dragCrop(box, "n", 0.1, 0.1, 1, 1)
  close(m.x, 0.3)
  close(m.y, 0.3)
})
