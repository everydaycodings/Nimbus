import assert from "node:assert/strict"
import { test } from "node:test"

import { contentRange, credential, paginate } from "./wire.ts"

const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`

test("credential reads the password of Basic and Bearer", () => {
  assert.equal(credential(basic("me:NMCRabc")), "NMCRabc")
  assert.equal(credential(basic("me:a:b")), "a:b")
  assert.equal(credential(basic("me:")), null)
  assert.equal(credential("Bearer NMCRabc"), "NMCRabc")
  assert.equal(credential(null), null)
  assert.equal(credential("Digest x"), null)
})

test("paginate follows n and last", () => {
  const all = ["a", "b", "c", "d"]
  const p = (qs: string) => paginate(new URLSearchParams(qs), all, "/v2/_catalog")
  assert.deepEqual(p("")?.items, all)
  assert.deepEqual(p("n=2"), { items: ["a", "b"], link: '</v2/_catalog?n=2&last=b>; rel="next"' })
  assert.deepEqual(p("n=2&last=b"), { items: ["c", "d"], link: undefined })
  assert.deepEqual(p("n=0")?.items, [])
  assert.equal(p("n=-1"), null)
  assert.equal(p("n=x"), null)
})

test("contentRange", () => {
  assert.deepEqual(contentRange("0-99"), { start: 0, end: 99 })
  assert.deepEqual(contentRange("bytes 5-9"), { start: 5, end: 9 })
  assert.equal(contentRange("9-5"), null)
  assert.equal(contentRange("abc"), null)
})
