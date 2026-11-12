import assert from "node:assert/strict"
import { test } from "node:test"
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib"

import { readMarks, writeMarks, type Mark } from "./pdf-annot.ts"

// 1x1 PNG
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
)

async function sample(link = true) {
  const doc = await PDFDocument.create()
  const p = doc.addPage([300, 400])
  doc.addPage([300, 400])
  if (link)
    p.node.set(
      PDFName.of("Annots"),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 50, 30], Border: [0, 0, 0] })
        ),
      ])
    )
  return doc.save()
}

const MARKS: Mark[] = [
  { kind: "highlight", page: 0, color: "#facc15", quads: [[10, 300, 120, 312], [10, 280, 90, 292]], opacity: 0.5 },
  { kind: "underline", page: 0, color: "#22c55e", quads: [[10, 200, 80, 212]] },
  { kind: "strike", page: 1, color: "#ef4444", quads: [[20, 100, 100, 112]], author: "Ann" },
  { kind: "note", page: 0, color: "#facc15", at: [200, 350], contents: "Check this é" },
  { kind: "text", page: 1, color: "#3b82f6", rect: [30, 300, 140, 330], size: 12, contents: "Hello\nworld" },
  { kind: "ink", page: 0, color: "#000000", width: 2, paths: [[[10, 10], [20, 25], [30, 12.5]], [[40, 40], [50, 50]]] },
  { kind: "rect", page: 0, color: "#ef4444", rect: [100, 100, 160, 140], width: 3 },
  { kind: "ellipse", page: 1, color: "#22c55e", rect: [100, 100, 160, 140], width: 1.5 },
  { kind: "line", page: 0, color: "#000000", a: [10, 10], b: [100, 60], width: 2 },
  { kind: "arrow", page: 1, color: "#3b82f6", a: [10, 10], b: [100, 60], width: 2 },
  { kind: "stamp", page: 0, color: "#000000", rect: [50, 50, 150, 90], png: PNG },
]

const subtypes = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().flatMap((p) => {
    const a = p.node.Annots()
    return a
      ? a.asArray().map((_, i) => (a.lookup(i, PDFDict).lookup(PDFName.of("Subtype")) as PDFName).decodeText())
      : []
  })
}

test("every mark kind survives a write and a read", async () => {
  const out = await writeMarks(await sample(), MARKS)
  const back = await readMarks(out)
  const key = (m: Mark) => `${m.page}${m.kind}`
  assert.deepEqual(
    back.sort((a, b) => key(a).localeCompare(key(b))),
    [...MARKS].sort((a, b) => key(a).localeCompare(key(b)))
  )
})

test("links stay and a removed mark is gone", async () => {
  const once = await writeMarks(await sample(), MARKS)
  assert.equal((await subtypes(once)).filter((s) => s === "Link").length, 1)
  const fewer = await writeMarks(once, MARKS.slice(1))
  const back = await readMarks(fewer)
  assert.equal(back.length, MARKS.length - 1)
  assert.ok(!back.some((m) => m.kind === "highlight"))
  assert.equal((await subtypes(fewer)).filter((s) => s === "Link").length, 1)
  const none = await writeMarks(fewer, [])
  assert.deepEqual(await subtypes(none), ["Link"])
})

test("saving again does not pile up objects", async () => {
  const one = await writeMarks(await sample(), MARKS)
  const two = await writeMarks(one, await readMarks(one))
  const three = await writeMarks(two, await readMarks(two))
  assert.ok(Math.abs(three.length - two.length) < 20)
})

test("appearances exist and a highlight multiplies", async () => {
  const doc = await PDFDocument.load(await writeMarks(await sample(false), MARKS))
  for (const p of doc.getPages()) {
    const a = p.node.Annots() as PDFArray
    for (let i = 0; i < a.size(); i++) {
      const d = a.lookup(i, PDFDict)
      assert.ok(d.lookup(PDFName.of("AP"), PDFDict).has(PDFName.of("N")))
    }
  }
  const raw = Buffer.from(await writeMarks(await sample(false), [MARKS[0]])).toString("latin1")
  assert.match(raw, /\/BM \/Multiply/)
})
