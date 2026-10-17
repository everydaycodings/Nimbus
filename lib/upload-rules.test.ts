// Run: node --test lib/upload-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.BETTER_AUTH_SECRET = "test-secret-one"
const {
  contentDisposition,
  extOf,
  freeName,
  readUploadToken,
  signUploadToken,
  splitPath,
} = await import("./upload-rules.ts")

test("splitPath accepts plain relative paths and refuses tricks", () => {
  assert.deepEqual(splitPath("Photos/2024/a.jpg"), ["Photos", "2024", "a.jpg"])
  assert.deepEqual(splitPath(".env"), [".env"])
  for (const bad of [
    "",
    "a//b",
    "/a",
    "a/",
    "../a",
    "a/./b",
    "a\\b",
    " /a",
    "x".repeat(256),
    5,
  ])
    assert.equal(splitPath(bad), null, String(bad))
})

test("freeName picks the lowest free number, ignoring case", () => {
  assert.equal(freeName("a.jpg", new Set(["a.jpg"])), "a (1).jpg")
  assert.equal(
    freeName("A.jpg", new Set(["a (1).jpg", "a (3).jpg"])),
    "A (2).jpg"
  )
  assert.equal(freeName("README", new Set()), "README (1)")
  assert.equal(freeName(".env", new Set()), ".env (1)")
  assert.equal(freeName("v1.2", new Set(), true), "v1.2 (1)")
  assert.equal(extOf("x.TAR.GZ"), "gz")
  assert.equal(extOf(".bashrc"), "")
})

test("contentDisposition keeps an ASCII fallback and a UTF-8 name", () => {
  assert.equal(
    contentDisposition('Résumé "1".pdf'),
    `attachment; filename="R_sum_ _1_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%221%22.pdf`
  )
  assert.match(contentDisposition("a.png", true), /^inline;/)
})

test("upload tokens verify, expire on paper, and reject tampering", () => {
  const t = signUploadToken("u1", null, 0)
  assert.deepEqual(readUploadToken(t), { u: "u1", p: null, exp: 86400000 })
  const [body, sig] = t.split(".")
  const forged = Buffer.from(
    JSON.stringify({ u: "u2", p: null, exp: 1e15 })
  ).toString("base64url")
  assert.equal(readUploadToken(`${forged}.${sig}`), null)
  assert.equal(readUploadToken(`${body}.AAAA`), null)
  assert.equal(readUploadToken("garbage"), null)
  process.env.BETTER_AUTH_SECRET = "test-secret-two"
  assert.equal(readUploadToken(t), null)
})
