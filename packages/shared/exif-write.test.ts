// Run: node --test packages/shared/exif-write.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { exifTakenAt } from "../../apps/web/lib/exif.ts"
import { exifOf, readExif, withExif } from "./exif-write.ts"

// SOI, JFIF APP0, one fake APP1 (XMP), SOS-ish tail, EOI.
const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
const xmp = [0xff, 0xe1, 0, 8, 0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f]
const tail = [0xff, 0xdb, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]
const jpeg = new Uint8Array([0xff, 0xd8, ...app0, ...xmp, ...tail])
const at = new Date(Date.UTC(2023, 6, 4, 18, 30, 5))

test("date and GPS round-trip, through our reader and the server's", () => {
  const out = withExif(jpeg, { takenAt: at, gps: { lat: 48.858222, lng: -2.294556 } })
  const back = readExif(out)
  assert.equal(back.takenAt?.toISOString(), at.toISOString())
  assert.ok(Math.abs(back.gps!.lat - 48.858222) < 1e-6 && Math.abs(back.gps!.lng + 2.294556) < 1e-6)
  assert.equal(exifTakenAt(exifOf(out)!)?.toISOString(), at.toISOString())
})

test("southern and western hemispheres, and a date with no GPS", () => {
  const s = readExif(withExif(jpeg, { gps: { lat: -33.8688, lng: 151.2093 }, takenAt: at })).gps!
  assert.ok(Math.abs(s.lat + 33.8688) < 1e-6 && Math.abs(s.lng - 151.2093) < 1e-6)
  assert.deepEqual(readExif(withExif(jpeg, { takenAt: at })), { takenAt: at })
  assert.deepEqual(readExif(withExif(jpeg, { gps: { lat: 1, lng: 2 } })).takenAt, undefined)
})

test("the JPEG stays valid: JFIF first, other segments and image data kept, old EXIF replaced", () => {
  const once = withExif(jpeg, { takenAt: at })
  const twice = withExif(once, { takenAt: new Date(Date.UTC(2020, 0, 2, 3, 4, 5)) })
  assert.deepEqual([...twice.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0])
  assert.equal(readExif(twice).takenAt?.toISOString(), "2020-01-02T03:04:05.000Z")
  assert.deepEqual([...twice.subarray(twice.length - tail.length)], tail)
  assert.equal(twice.filter((_, i) => twice[i] === 0xff && twice[i + 1] === 0xe1).length, 2) // ours and the XMP one
  assert.equal(exifOf(jpeg), null)
})

test("not a JPEG: untouched", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  assert.equal(withExif(png, { takenAt: at }), png)
})
