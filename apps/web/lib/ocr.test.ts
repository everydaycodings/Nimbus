// Run: node --test lib/ocr.test.ts   (needs ffmpeg with drawtext; OCR data comes from .cache/tessdata)
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { PDFDocument } from "pdf-lib"
import sharp from "sharp"

const { closeOcr, extractParts } = await import("./extract.ts")
const { videoParts, mergeFrames } = await import("../scripts/video-ocr.ts")

after(closeOcr)

const svg = (text: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="100%" height="100%" fill="white"/><text x="60" y="150" font-size="64" font-family="sans-serif" fill="black">${text}</text><text x="60" y="300" font-size="64" font-family="sans-serif" fill="black">second line here</text></svg>`
  )

test("image lines come with boxes", async () => {
  const png = await sharp(svg("Invoice total 4200")).png().toBuffer()
  const { body, parts, ocr } = await extractParts(png, "ocr")
  assert.match(body, /Invoice total/i)
  assert.equal(ocr, "eng")
  const p = parts.find((x) => /invoice/i.test(x.body))!
  assert.equal(p.kind, "line")
  const [x, y, w, h] = p.box!
  assert.ok(x < 0.2 && y > 0.1 && y < 0.5 && w > 0.3 && h > 0 && x + w <= 1 && y + h <= 1)
})

test("scanned PDF pages are read, only when allowed", async () => {
  const png = await sharp(svg("Quarterly report summary")).png().toBuffer()
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([500, 200])
    page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: 500, height: 200 })
  }
  const bytes = await pdf.save()
  const on = await extractParts(bytes.slice(), "pdf", "eng", true)
  assert.deepEqual(on.parts.map((p) => p.page), [1, 2])
  assert.match(on.parts[1].body, /Quarterly report/i)
  assert.equal(on.ocr, "eng")
  const off = await extractParts(bytes.slice(), "pdf", "eng", false)
  assert.equal(off.parts.length, 0)
  assert.equal(off.ocr, "-")
})

test("repeated frame text merges at the first time", () => {
  const parts = mergeFrames([
    { tMs: 0, body: "Hello world from the slide" },
    { tMs: 5000, body: "Hello world from the slide" },
    { tMs: 10000, body: "Something completely different here" },
  ])
  assert.deepEqual(parts.map((p) => p.tMs), [0, 10000])
})

test("video text becomes time parts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ocr-test-"))
  try {
    const out = join(dir, "t.mp4")
    const draw = (t: string, a: number, b: number) =>
      `drawtext=text='${t}':fontsize=64:fontcolor=black:x=60:y=150:enable='between(t,${a},${b})'`
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=white:s=1280x720:d=12:r=10",
      "-vf", [draw("Welcome to the demo", 0, 5.9), draw("Pricing starts at nine", 6, 12)].join(","),
      "-pix_fmt", "yuv420p", out])
    const parts = await videoParts(out, "eng", 5)
    assert.ok(parts.length >= 2, JSON.stringify(parts))
    assert.equal(parts[0].tMs, 0)
    assert.match(parts[0].body, /welcome/i)
    assert.ok(parts.some((p) => /pricing/i.test(p.body) && (p.tMs ?? 0) >= 5000))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
