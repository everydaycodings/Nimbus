// Run: node --test packages/shared/file-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { acceptOf, typeAllowed, typesLabel } from "./file-rules.ts"

test("typeAllowed", () => {
  assert.ok(typeAllowed("a.exe", null))
  assert.ok(typeAllowed("Scan.PDF", ["pdf"]))
  assert.ok(typeAllowed("x.jpeg", ["images", ".psd"]))
  assert.ok(typeAllowed("x.PSD", ["images", ".psd"]))
  assert.ok(!typeAllowed("x.exe", ["images", ".psd"]))
  assert.ok(!typeAllowed("x.pdf", ["bogus"]))
})

test("acceptOf and typesLabel", () => {
  const a = acceptOf(["images", "pdf", ".psd"])!.split(",")
  for (const e of [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".pdf", ".psd"])
    assert.ok(a.includes(e), e)
  assert.equal(acceptOf([]), undefined)
  assert.equal(typesLabel(["images", "pdf", ".psd"]), "images, PDFs or .psd")
})
