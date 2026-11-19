import assert from "node:assert/strict"
import { test } from "node:test"

import { checkCors, checkLifecycle, quotaError } from "./config-rules.ts"
import { actualHeaders, matchRule, preflightHeaders } from "./cors.ts"

const rule = { origins: ["https://a.example.com"], methods: ["GET", "PUT"] as ("GET" | "PUT")[], headers: ["Content-Type"], expose: ["ETag"], maxAgeSeconds: 600 }

test("matchRule checks origin, method and asked headers", () => {
  assert.equal(matchRule([rule], "https://a.example.com", "get", ["content-type"]), rule)
  assert.equal(matchRule([rule], "https://b.example.com", "GET"), undefined)
  assert.equal(matchRule([rule], "https://a.example.com", "DELETE"), undefined)
  assert.equal(matchRule([rule], "https://a.example.com", "PUT", ["x-amz-meta-a"]), undefined)
  assert.ok(matchRule([{ ...rule, origins: ["*"], headers: ["*"] }], "https://z.test", "PUT", ["x-any"]))
})

test("headers", () => {
  assert.equal(preflightHeaders(rule, "https://a.example.com", "content-type")["Access-Control-Max-Age"], "600")
  assert.equal(actualHeaders({ ...rule, origins: ["*"] }, "https://q.test")["Access-Control-Allow-Origin"], "*")
  assert.equal(actualHeaders(rule, "https://a.example.com")["Access-Control-Expose-Headers"], "ETag")
})

test("checkCors", () => {
  assert.ok("rules" in checkCors([rule]))
  for (const bad of [
    { ...rule, origins: ["https://a.example.com/path"] },
    { ...rule, origins: ["ftp://a.com"] },
    { ...rule, origins: [] },
    { ...rule, methods: ["PATCH"] },
    { ...rule, methods: [] },
    { ...rule, headers: ["bad header"] },
    { ...rule, maxAgeSeconds: 86_401 },
    { ...rule, maxAgeSeconds: -1 },
  ])
    assert.ok("error" in checkCors([bad as never]), JSON.stringify(bad))
  assert.ok("error" in checkCors(Array(11).fill(rule)))
})

test("checkLifecycle", () => {
  const ok = { id: "a", prefix: "logs/", expireDays: 30, noncurrentDays: null, abortMultipartDays: null }
  assert.ok("rules" in checkLifecycle([ok, { ...ok, id: "b", prefix: "" }]))
  assert.ok("error" in checkLifecycle([ok, ok]))
  assert.ok("error" in checkLifecycle([{ ...ok, prefix: "/x" }]))
  assert.ok("error" in checkLifecycle([{ ...ok, expireDays: 0 }]))
  assert.ok("error" in checkLifecycle([{ ...ok, expireDays: 1.5 }]))
  assert.ok("error" in checkLifecycle([{ ...ok, expireDays: 36_501 }]))
  assert.ok("error" in checkLifecycle([{ ...ok, expireDays: null }]))
  assert.ok("error" in checkLifecycle(Array.from({ length: 21 }, (_, i) => ({ ...ok, id: `r${i}` }))))
})

test("quotaError", () => {
  assert.equal(quotaError(null), null)
  assert.equal(quotaError(5 * 1024 ** 3), null)
  assert.ok(quotaError(1000))
  assert.ok(quotaError(2 ** 60))
})
