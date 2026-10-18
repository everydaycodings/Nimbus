// node scripts/check-password-policy.ts
import assert from "node:assert/strict"

import { passwordProblem } from "../lib/password-policy.ts"

// No policy: industry-standard length floors only.
assert.equal(passwordProblem("a".repeat(9), null), "Use at least 10 characters.")
assert.equal(passwordProblem("a".repeat(10), null), null)
assert.match(passwordProblem("a".repeat(11), null, true)!, /12/)
assert.match(passwordProblem("a".repeat(129), null)!, /at most/)

const policy = {
  min: 8,
  lower: true,
  upper: true,
  digit: true,
  symbol: true,
  exclude: "\"' ",
}
assert.equal(passwordProblem("Abcdef1!", policy), null)
assert.equal(passwordProblem("Abcdef1!", policy, true), null) // owner's min wins
assert.match(passwordProblem("abcdef1!", policy)!, /uppercase/)
assert.match(passwordProblem("ABCDEF1!", policy)!, /lowercase/)
assert.match(passwordProblem("Abcdefg!", policy)!, /number/)
assert.match(passwordProblem("Abcdefg1", policy)!, /symbol/)
assert.match(passwordProblem("Abcd ef1!", policy)!, /space/)
assert.match(passwordProblem("Abcd'ef1!", policy)!, /no/)
assert.equal(passwordProblem("Ébcdéf1!", policy), null) // non-ASCII letters count

console.log("password policy: ok")
