// Run: node --test lib/extract.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { downloadZip } from "client-zip"
import * as XLSX from "xlsx"

const { extractText, sourceOf, tooBig } = await import("./extract.ts")

const bytes = (s: string) => new TextEncoder().encode(s)

test("sourceOf maps preview kinds to readers", () => {
  assert.equal(sourceOf("markdown"), "text")
  assert.equal(sourceOf("image"), "ocr")
  assert.equal(sourceOf("docx"), "docx")
  assert.equal(sourceOf("pptx"), "pptx")
  assert.equal(sourceOf("video"), null)
  assert.equal(sourceOf(null), null)
  assert.equal(tooBig("ocr", 21 * 1024 * 1024), true)
  assert.equal(tooBig("pdf", 21 * 1024 * 1024), false)
})

test("text is tidied, and binary files have none", async () => {
  assert.equal(
    await extractText(
      bytes("  Hello\t\tworld \r\n\n\n next\u0001line "),
      "text"
    ),
    "Hello world\nnext line"
  )
  assert.equal(await extractText(new Uint8Array([80, 75, 0, 1]), "text"), "")
})

test("docx paragraphs, tabs and entities", async () => {
  const xml =
    "<w:document><w:body><w:p><w:r><w:t>Fish &amp; chips</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B &#233;t&#xE9;</w:t></w:r></w:p></w:body></w:document>"
  const zip = new Uint8Array(
    await downloadZip([{ name: "word/document.xml", input: xml }]).arrayBuffer()
  )
  assert.equal(await extractText(zip, "docx"), "Fish & chips\nA B été")
})

test("every sheet, named", async () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Region", "Total"],
      ["North", 42],
    ]),
    "Sales"
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Zanzibar"]]),
    "Notes"
  )
  const out = await extractText(
    new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
    "sheet"
  )
  assert.equal(out, "Sales\nRegion,Total\nNorth,42\nNotes\nZanzibar")
})
