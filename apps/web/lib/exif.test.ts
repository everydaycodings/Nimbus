// Run: node --test lib/exif.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { exifGps, exifTakenAt, parseExifDate } from "./exif.ts"

// A TIFF with IFD0 -> Exif IFD holding DateTimeOriginal, in either byte order.
function tiff(date: string, le: boolean, prefix = false) {
  const text = `${date}\0`
  const b = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + text.length)
  const w16 = (o: number, n: number) => (le ? b.writeUInt16LE(n, o) : b.writeUInt16BE(n, o))
  const w32 = (o: number, n: number) => (le ? b.writeUInt32LE(n, o) : b.writeUInt32BE(n, o))
  b.write(le ? "II" : "MM", 0)
  w16(2, 42)
  w32(4, 8)
  w16(8, 1) // IFD0: one entry, the Exif pointer
  w16(10, 0x8769)
  w16(12, 4)
  w32(14, 1)
  w32(18, 26)
  w32(22, 0)
  w16(26, 1) // Exif IFD: DateTimeOriginal
  w16(28, 0x9003)
  w16(30, 2)
  w32(32, text.length)
  w32(36, 44)
  w32(40, 0)
  b.write(text, 44, "latin1")
  return prefix ? Buffer.concat([Buffer.from("Exif\0\0"), b]) : b
}

test("reads DateTimeOriginal in both byte orders, with or without the Exif header", () => {
  const want = new Date("2024-05-17T14:03:09Z")
  for (const le of [true, false])
    for (const prefix of [true, false])
      assert.deepEqual(exifTakenAt(tiff("2024:05:17 14:03:09", le, prefix)), want)
})

test("junk and blank dates give null", () => {
  assert.equal(exifTakenAt(Buffer.from("not exif at all")), null)
  assert.equal(exifTakenAt(tiff("0000:00:00 00:00:00", true)), null)
  assert.equal(parseExifDate("2024:13:40 99:00:00"), null)
  assert.equal(exifTakenAt(tiff("2024:05:17 14:03:09", true).subarray(0, 30)), null)
})

// IFD0 -> GPS IFD with N/S + E/W refs and degrees/minutes/seconds rationals.
function gpsTiff(le: boolean, latRef: string, lat: number[], lngRef: string, lng: number[]) {
  const b = Buffer.alloc(128)
  const w16 = (o: number, n: number) => (le ? b.writeUInt16LE(n, o) : b.writeUInt16BE(n, o))
  const w32 = (o: number, n: number) => (le ? b.writeUInt32LE(n, o) : b.writeUInt32BE(n, o))
  b.write(le ? "II" : "MM", 0)
  w16(2, 42)
  w32(4, 8)
  w16(8, 1)
  w16(10, 0x8825)
  w16(12, 4)
  w32(14, 1)
  w32(18, 26)
  w16(26, 4)
  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const at = 28 + i * 12
    w16(at, tag)
    w16(at + 2, type)
    w32(at + 4, count)
    if (type === 2) b.write(String.fromCharCode(value), at + 8, "latin1")
    else w32(at + 8, value)
  }
  entry(0, 1, 2, 2, latRef.charCodeAt(0))
  entry(1, 2, 5, 3, 80)
  entry(2, 3, 2, 2, lngRef.charCodeAt(0))
  entry(3, 4, 5, 3, 104)
  ;[...lat, ...lng].forEach((n, i) => {
    w32(80 + i * 8, n)
    w32(84 + i * 8, 1)
  })
  return b
}

test("reads GPS in both byte orders and signs by hemisphere", () => {
  for (const le of [true, false]) {
    const g = exifGps(gpsTiff(le, "N", [48, 51, 30], "E", [2, 21, 0]))!
    assert.ok(Math.abs(g.lat - 48.858333) < 1e-5 && Math.abs(g.lng - 2.35) < 1e-5)
    const s = exifGps(gpsTiff(le, "S", [33, 52, 0], "W", [151, 12, 0]))!
    assert.ok(s.lat < 0 && s.lng < 0)
  }
})

test("no GPS, 0,0 or junk give null", () => {
  assert.equal(exifGps(tiff("2024:05:17 14:03:09", true)), null)
  assert.equal(exifGps(gpsTiff(true, "N", [0, 0, 0], "E", [0, 0, 0])), null)
  assert.equal(exifGps(gpsTiff(true, "N", [99, 0, 0], "E", [2, 0, 0])), null)
  assert.equal(exifGps(Buffer.from("not exif at all")), null)
})
