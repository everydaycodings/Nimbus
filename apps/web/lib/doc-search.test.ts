// Run: node --test lib/doc-search.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { parseDocTokens } from "./doc-search.ts"

test("reads every filter word and leaves the rest", () => {
  const a = parseDocTokens(
    'type:receipt sender:"Acme Corp" amount>50 amount<=200 year:2025 expires:soon rent'
  )
  assert.deepEqual(a.tokens, {
    type: "receipt",
    sender: "Acme Corp",
    minAmount: 50,
    maxAmount: 200,
    year: 2025,
    expires: "soon",
  })
  assert.equal(a.rest, "rent")
})

test("ignores values that aren't filters", () => {
  const a = parseDocTokens("year:abc expires:never hello")
  assert.deepEqual(a.tokens, {})
  assert.equal(a.rest, "year:abc expires:never hello")
})

test("decimal comma", () => {
  assert.equal(parseDocTokens("amount>12,5").tokens.minAmount, 12.5)
})

test("amount accepts thousands separators and refuses junk", () => {
  assert.equal(parseDocTokens("amount>1,234.56").tokens.minAmount, 1234.56)
  assert.equal(parseDocTokens("amount<1.234,50").tokens.maxAmount, 1234.5)
  assert.equal(parseDocTokens("amount>50").tokens.minAmount, 50)
})
