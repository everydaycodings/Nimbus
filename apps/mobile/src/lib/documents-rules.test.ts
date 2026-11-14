import assert from "node:assert/strict"
import { test } from "node:test"

import type { DocumentItem } from "@nimbus/shared/documents-api"

import { applyDocOp, expiryInfo, filterCount, formFrom, NO_FILTERS, parseAmount, patchFrom, toItem, toQuery } from "./documents-rules.ts"
import { canQueue, idsOf, remap } from "./offline-rules.ts"

const doc = (over: Partial<DocumentItem> = {}): DocumentItem => ({
  id: "d1", name: "bill.pdf", mime: "application/pdf", size: 10, version: "v1", thumb: null, folderId: null, updatedAt: "2026-01-01T00:00:00Z",
  role: "owner", owner: null, status: "review", source: "auto", typeId: "t1", typeName: "Bill", senderId: "s1", senderName: "Acme",
  docDate: "2026-01-02", amount: 12.5, currency: "USD", expiresAt: null, remindDays: 3, remindOverride: null, notes: null, fields: {},
  guess: {}, dupOf: null, missing: [], daysLeft: null, ...over,
})

test("filters become the API's query, leaving empty ones out", () => {
  assert.equal(toQuery(NO_FILTERS, 60), "sort=date&order=desc&limit=60")
  const f = { ...NO_FILTERS, q: " rent ", status: "review" as const, minAmount: "1,000.50", expiring: "soon" as const, missing: ["sender", "date"] as ("sender" | "date")[] }
  assert.equal(toQuery(f, 60, 120), "q=rent&status=review&minAmount=1000.5&expiring=soon&missing=sender%2Cdate&sort=date&order=desc&limit=60&cursor=120")
  assert.equal(toQuery({ ...NO_FILTERS, minAmount: "abc" }, 5), "sort=date&order=desc&limit=5")
})

test("amounts accept both decimal marks", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5)
  assert.equal(parseAmount("12,5"), 12.5)
  assert.equal(parseAmount(""), null)
  assert.equal(parseAmount("-3"), null)
  assert.equal(parseAmount("x"), null)
})

test("one chip per kind of filter", () => {
  assert.equal(filterCount(NO_FILTERS), 0)
  assert.equal(filterCount({ ...NO_FILTERS, type: "t", year: 2025, from: "2025-01-01", minAmount: "5", maxAmount: "9", missing: ["type", "date"] }), 4)
})

test("expiry wording follows the reminder window", () => {
  assert.equal(expiryInfo(doc()), null)
  assert.deepEqual(expiryInfo(doc({ expiresAt: "2026-02-01", daysLeft: -2 })), { text: "Expired 2 days ago", tone: "danger" })
  assert.deepEqual(expiryInfo(doc({ expiresAt: "2026-02-01", daysLeft: 0 })), { text: "Due today", tone: "danger" })
  assert.deepEqual(expiryInfo(doc({ expiresAt: "2026-02-01", daysLeft: 3, remindDays: 3 })), { text: "In 3 days", tone: "warn" })
  assert.deepEqual(expiryInfo(doc({ expiresAt: "2026-02-01", daysLeft: 40, remindDays: 3 })), { text: "Until 2026-02-01", tone: "muted" })
  assert.equal(expiryInfo(doc({ expiresAt: "2026-02-01", daysLeft: 25, remindDays: null }))?.tone, "warn")
})

test("the editor sends only what changed, and says what's wrong", () => {
  const d = doc()
  assert.deepEqual(patchFrom(formFrom(d), d), { patch: {} })
  const f = { ...formFrom(d), sender: "Beta", amount: "20", currency: "eur", remindDays: "7", notes: " hi ", fields: [{ k: " ref ", v: "9" }, { k: "", v: "x" }] }
  assert.deepEqual(patchFrom(f, d), { patch: { senderName: "Beta", amount: 20, currency: "EUR", remindDays: 7, notes: "hi", fields: { ref: "9" } } })
  assert.deepEqual(patchFrom({ ...formFrom(d), sender: "" }, d), { patch: { senderId: null } })
  assert.ok("error" in patchFrom({ ...formFrom(d), amount: "abc" }, d))
  assert.ok("error" in patchFrom({ ...formFrom(d), currency: "US" }, d))
  assert.ok("error" in patchFrom({ ...formFrom(d), remindDays: "-1" }, d))
  assert.deepEqual(patchFrom({ ...formFrom(d), amount: "", docDate: null }, d), { patch: { amount: null, docDate: null } })
})

test("waiting document changes show in lists", () => {
  const a = doc(), b = doc({ id: "d2" })
  const edit = { op: "docPatch" as const, id: "d1", patch: { amount: 99, typeId: "t2", status: "confirmed" as const }, typeName: "Receipt" }
  const [x, y] = applyDocOp([a, b], edit)
  assert.equal(x.amount, 99)
  assert.equal(x.typeName, "Receipt")
  assert.equal(x.status, "confirmed")
  assert.equal(y, b)
  // Confirmed leaves Needs review; Not a document leaves everything but its own list.
  assert.deepEqual(applyDocOp([a, b], edit, "review").map((d) => d.id), ["d2"])
  const no = { op: "docMark" as const, ids: ["d1"], on: false }
  assert.deepEqual(applyDocOp([a, b], no).map((d) => d.id), ["d2"])
  assert.deepEqual(applyDocOp([a, b], no, "dismissed").map((d) => d.id), ["d1", "d2"])
  assert.deepEqual(applyDocOp([a, b], { ...no, on: true }, "dismissed").map((d) => d.id), ["d2"])
})

test("document changes can wait and are remapped like the rest", () => {
  assert.ok(canQueue("docPatch") && canQueue("docMark"))
  assert.deepEqual(idsOf({ op: "docPatch", id: "d1", patch: {} }), ["d1"])
  assert.deepEqual(idsOf({ op: "docMark", ids: ["a", "b"], on: true }), ["a", "b"])
  assert.deepEqual(remap({ op: "docPatch", id: "temp-1", patch: {} }, { "temp-1": "real" }), { op: "docPatch", id: "real", patch: {} })
})

test("a document opens in the previewer as its file; shared ones as viewer", () => {
  assert.equal(toItem(doc()).role, undefined)
  assert.equal(toItem(doc({ role: "viewer", owner: "Sam" })).role, "viewer")
})
