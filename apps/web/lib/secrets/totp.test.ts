import assert from "node:assert/strict"
import { test } from "node:test"

import { parseOtpauth, totp } from "./totp.ts"

// RFC 6238 appendix B, 8 digits.
const K = { SHA1: "12345678901234567890", SHA256: "12345678901234567890123456789012", SHA512: "1234567890123456789012345678901234567890123456789012345678901234" }
const V: [number, string, string, string][] = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
]
test("RFC 6238 vectors", () => {
  for (const [t, a, b, c] of V)
    for (const [alg, want] of [["SHA1", a], ["SHA256", b], ["SHA512", c]] as const)
      assert.equal(totp(Buffer.from(K[alg]), t * 1000, { digits: 8, algorithm: alg }).code, want, `${alg}@${t}`)
})
test("countdown and base32", () => {
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000).remaining, 1)
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000).code, "287082")
})
test("otpauth", () => {
  const o = parseOtpauth("otpauth://totp/Acme:bob@x.com?secret=gezd gnbv&issuer=Acme&digits=8&period=60&algorithm=SHA256")
  assert.deepEqual([o.secret, o.digits, o.period, o.algorithm, o.issuer, o.label], ["GEZDGNBV", 8, 60, "SHA256", "Acme", "Acme:bob@x.com"])
  assert.equal(parseOtpauth("gezd gnbv").secret, "GEZDGNBV")
  assert.throws(() => parseOtpauth("otpauth://hotp/x?secret=GEZDGNBV"))
  assert.throws(() => parseOtpauth("not base32 !!"))
})
