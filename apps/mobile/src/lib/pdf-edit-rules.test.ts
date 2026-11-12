import assert from "node:assert/strict"
import { test } from "node:test"

import { PDF_EDIT_MAX_DEFAULT, RED, YELLOW, canEditPdf, cmdScript, colorFor, needsColor, needsWidth, parseMsg, saveChoice, saveComplete } from "./pdf-edit-rules.ts"

const pdf = { name: "a.pdf", mime: "application/pdf", size: 1000 }
const ok = { editable: true, vault: false, version: false }

test("Edit shows for an editable PDF only", () => {
  assert.ok(canEditPdf(pdf, ok))
  assert.ok(!canEditPdf(pdf, { ...ok, editable: false }), "viewer role or link")
  assert.ok(!canEditPdf(pdf, { ...ok, vault: true }))
  assert.ok(!canEditPdf(pdf, { ...ok, version: true }))
  assert.ok(!canEditPdf({ ...pdf, name: "a.txt", mime: "text/plain" }, ok))
})

test("the size cap hides Edit; an old server's missing cap means 100 MB", () => {
  assert.ok(canEditPdf({ ...pdf, size: 5000 }, { ...ok, max: 5000 }))
  assert.ok(!canEditPdf({ ...pdf, size: 5001 }, { ...ok, max: 5000 }))
  assert.ok(canEditPdf({ ...pdf, size: PDF_EDIT_MAX_DEFAULT }, ok))
  assert.ok(!canEditPdf({ ...pdf, size: PDF_EDIT_MAX_DEFAULT + 1 }, ok))
})

test("highlighter turns yellow and the other tools go back to red, unless a colour was chosen", () => {
  assert.equal(colorFor("highlight", RED), YELLOW)
  assert.equal(colorFor("pen", YELLOW), RED)
  assert.equal(colorFor("pen", "#3b82f6"), "#3b82f6")
  assert.equal(colorFor("highlight", "#22c55e"), "#22c55e")
  assert.equal(colorFor("note", YELLOW), YELLOW, "a sticky note has no colour of its own to reset")
})

test("colour and width show for the tools that use them", () => {
  assert.ok(needsColor("highlight") && !needsColor("note") && !needsColor("eraser") && !needsColor("stamp"))
  assert.ok(needsWidth("pen") && !needsWidth("highlight") && !needsWidth("select"))
})

test("a new version asks first only when the file moved on and Overwrite wasn't chosen", () => {
  assert.equal(saveChoice("version", false, "v1", "v2"), "ask")
  assert.equal(saveChoice("version", false, "v1", "v1"), "save")
  assert.equal(saveChoice("version", true, "v1", "v2"), "save")
  assert.equal(saveChoice("copy", false, "v1", "v2"), "save")
  assert.equal(saveChoice("version", false, undefined, "v2"), "save", "no version captured, nothing to compare")
})

test("commands are one safe line of script", () => {
  assert.equal(cmdScript({ c: "tool", v: "pen" }), `__cmd({"c":"tool","v":"pen"});true;`)
  assert.ok(!cmdScript({ c: "stamp", b64: "a'b\"c" }).includes("\n"))
})

test("messages from the page are checked", () => {
  assert.deepEqual(parseMsg(`{"t":"read","id":1,"offset":0,"length":10}`), { t: "read", id: 1, offset: 0, length: 10 })
  assert.equal(parseMsg(`{"t":"read","id":1}`), null)
  assert.equal(parseMsg("nope"), null)
  assert.equal(parseMsg(`{"t":"state"}`), null)
  assert.equal(parseMsg(`{"t":"part","id":1,"i":0}`), null)
  assert.ok(parseMsg(`{"t":"saved","id":2,"parts":3,"size":9}`))
})

test("a save is whole when every part came and the length matches", () => {
  assert.ok(saveComplete(3, 3, 100, 100))
  assert.ok(!saveComplete(3, 2, 100, 100))
  assert.ok(!saveComplete(3, 3, 100, 90))
})
