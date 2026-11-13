// Run: node --test lib/secrets/gov-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  accessMinutes,
  checkSchema,
  groupTimeline,
  planRollback,
  reviewState,
  shareMinutes,
  validPattern,
  type Shape,
} from "./gov-rules.ts"

test("schemas: url, int, regex; empty passes", () => {
  assert.equal(checkSchema("url", null, "https://a.b/c"), null)
  assert.ok(checkSchema("url", null, "nope"))
  assert.equal(checkSchema("int", null, "-42"), null)
  assert.ok(checkSchema("int", null, "4.2"))
  assert.equal(checkSchema("regex", "^sk_[a-z]+$", "sk_live"), null)
  assert.ok(checkSchema("regex", "^sk_[a-z]+$", "pk_live"))
  assert.equal(checkSchema("int", null, ""), null)
  assert.equal(checkSchema("any", null, "whatever"), null)
  assert.equal(validPattern("("), false)
  assert.equal(validPattern("^a+$"), true)
})

test("timeline groups one person's rows within 3 seconds", () => {
  const t = (s: number) => new Date(1_700_000_000_000 + s * 1000)
  const m = groupTimeline([
    { by: "a", at: t(100), action: "update", key: "X" },
    { by: "a", at: t(100), action: "create", key: "Y" },
    { by: "b", at: t(99), action: "update", key: "X" },
    { by: "a", at: t(50), action: "delete", key: "Z" },
  ])
  assert.equal(m.length, 3)
  assert.deepEqual(m[0].counts, { update: 1, create: 1 })
  assert.deepEqual(m[0].keys, ["X", "Y"])
})

const shape = (key: string, value: string, folder = ""): Shape => ({ key, folder, value, comment: null, type: null })

test("rollback plan: add, change, delete; live secrets keep their folder", () => {
  const then = new Map<string, Shape | null>([
    ["a", shape("A", "1")], // unchanged
    ["b", shape("B", "old")], // changed since
    ["c", shape("C", "gone", "app")], // deleted since
    ["d", null], // didn't exist yet
  ])
  const now = new Map<string, Shape>([
    ["a", shape("A", "1")],
    ["b", shape("B", "new", "moved")],
    ["d", shape("D", "x")],
    ["e", shape("E", "created later")],
  ])
  const steps = planRollback(then, now)
  assert.deepEqual(steps.map((s) => `${s.kind}:${s.id}`).sort(), ["add:c", "change:b", "delete:d", "delete:e"])
  const change = steps.find((s) => s.kind === "change")!
  assert.equal(change.kind === "change" && change.to.folder, "moved")
  assert.deepEqual(change.kind === "change" && change.fields, ["value"])
})

test("reviews: author never counts, rejections win, needs N approvals", () => {
  const ok = (n: number, who: Set<string> | null, r: { userId: string; decision: "approve" | "reject" }[]) =>
    reviewState(n, who, "author", r)
  assert.equal(ok(1, null, []), "pending")
  assert.equal(ok(1, null, [{ userId: "author", decision: "approve" }]), "pending")
  assert.equal(ok(1, null, [{ userId: "x", decision: "approve" }]), "approved")
  assert.equal(ok(2, null, [{ userId: "x", decision: "approve" }]), "pending")
  assert.equal(ok(1, new Set(["y"]), [{ userId: "x", decision: "approve" }]), "pending")
  assert.equal(ok(1, null, [{ userId: "x", decision: "approve" }, { userId: "z", decision: "reject" }]), "rejected")
})

test("durations are bounded", () => {
  assert.equal(accessMinutes(60), 60)
  assert.equal(accessMinutes(5), null)
  assert.equal(shareMinutes(60), 60)
  assert.equal(shareMinutes(60 * 24 * 31), null)
})
