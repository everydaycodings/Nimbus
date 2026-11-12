// Run: node --test smart-groups.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { ocrGroups, smartRules, type SmartInput } from "./smart-groups.ts"

const f = (o: Partial<SmartInput>): SmartInput => ({
  name: "a.jpg",
  path: "Photos",
  mime: "image/jpeg",
  width: 4000,
  height: 3000,
  camera: false,
  ...o,
})

test("videos by type", () => {
  assert.deepEqual(smartRules(f({ name: "clip.mp4", mime: "video/mp4" })), ["videos"])
  assert.deepEqual(smartRules(f({ name: "clip.mov", mime: null })), ["videos"])
})

test("screenshots by name, path, or phone-screen PNG without a camera", () => {
  assert.deepEqual(smartRules(f({ name: "Screenshot_2024-01-01.png" })), ["screenshots"])
  assert.deepEqual(smartRules(f({ path: "Pictures/Screenshots" })), ["screenshots"])
  assert.deepEqual(smartRules(f({ name: "x.png", width: 1080, height: 2400 })), ["screenshots"])
  assert.deepEqual(smartRules(f({ name: "x.png", width: 1080, height: 2400, camera: true })), [])
  assert.equal(smartRules(f({ name: "x.png", width: 4000, height: 3000 })), null)
})

test("documents and receipts by name, folders by scan names", () => {
  assert.deepEqual(smartRules(f({ name: "Scan 12.jpg" })), ["documents"])
  assert.deepEqual(smartRules(f({ path: "Phone backup/Scans" })), ["documents"])
  assert.deepEqual(smartRules(f({ name: "invoice-44.jpg" })), ["receipts"])
  assert.equal(smartRules(f({ name: "scanner.jpg" })), null)
})

test("camera photos and non-images are decided, the rest need OCR", () => {
  assert.deepEqual(smartRules(f({ camera: true })), [])
  assert.deepEqual(smartRules(f({ name: "a.pdf", mime: "application/pdf" })), [])
  assert.equal(smartRules(f({})), null)
})

test("OCR text: receipts need shopping words and an amount, documents need a page of words", () => {
  assert.deepEqual(ocrGroups("Coffee 3.50\nSubtotal 3.50\nVAT 0.70\nTotal 4.20"), ["receipts"])
  assert.deepEqual(ocrGroups("Total of everything"), [])
  assert.deepEqual(ocrGroups("lorem ipsum dolor sit amet ".repeat(12)), ["documents"])
  assert.deepEqual(ocrGroups("hello"), [])
})
