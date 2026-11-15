// Run: node --test lib/registry/rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  atLeast,
  maxRole,
  scopeAllows,
  endpoint,
  evaluatePolicy,
  matchPattern,
  newToken,
  parseDigest,
  registryNameError,
  splitName,
  splitToken,
  untaggedToDelete,
  validRepoName,
  validTag,
  validUploadDigest,
} from "./rules.ts"

test("tokens look right and split back", () => {
  const t = newToken()
  assert.match(t.prefix, /^NMCR[A-Z2-7]{16}$/)
  assert.equal(t.secret.length, 40)
  assert.deepEqual(splitToken(t.token), { prefix: t.prefix, secret: t.secret })
  assert.equal(splitToken("nope"), null)
})

test("repo names and tags follow the distribution spec", () => {
  for (const ok of ["a", "app", "a/b", "my.app/sub_dir/x__y", "a--b", "team/app-1"]) assert.ok(validRepoName(ok), ok)
  for (const bad of ["", "A", "a//b", "/a", "a/", "-a", "a-", "a._b", "a/b/", "a".repeat(256)]) assert.ok(!validRepoName(bad), bad)
  for (const ok of ["latest", "v1.2.3", "_x", "a".repeat(128)]) assert.ok(validTag(ok), ok)
  for (const bad of ["", ".x", "-x", "a".repeat(129), "a:b"]) assert.ok(!validTag(bad), bad)
})

test("splitName and registry names", () => {
  assert.deepEqual(splitName("alice/app"), { namespace: "alice", repo: "app" })
  assert.deepEqual(splitName("team/a/b"), { namespace: "team", repo: "a/b" })
  assert.equal(splitName("alice"), null)
  assert.equal(splitName("Alice/app"), null)
  assert.equal(registryNameError("alice"), null)
  for (const bad of ["a", "Alice", "mirror", "admin", "-ab", "a--b", "a".repeat(40)]) assert.notEqual(registryNameError(bad), null, bad)
})

test("digests", () => {
  const h = "a".repeat(64)
  assert.deepEqual(parseDigest(`sha256:${h}`), { algo: "sha256", hex: h })
  assert.equal(parseDigest(`sha512:${"b".repeat(128)}`)?.algo, "sha512")
  assert.equal(parseDigest(`sha256:${h}0`), null)
  assert.equal(parseDigest(`md5:${h}`), null)
  assert.ok(validUploadDigest(`sha256:${h}`))
  assert.ok(!validUploadDigest(`sha512:${"b".repeat(128)}`))
})

test("endpoint", () => {
  assert.equal(endpoint({}), null)
  assert.equal(endpoint({ REGISTRY_DOMAIN: "cr.example.com/" }), "https://cr.example.com")
  assert.equal(endpoint({ REGISTRY_DOMAIN: "http://localhost:3408" }), "http://localhost:3408")
})

test("patterns", () => {
  assert.ok(matchPattern("v*", "v1.2"))
  assert.ok(!matchPattern("v*", "latest"))
  assert.ok(matchPattern("v?.0,rel-*", "rel-5"))
  assert.ok(matchPattern("re:^\\d+\\.\\d+$", "1.2"))
  assert.ok(!matchPattern("re:(", "x"))
  assert.ok(!matchPattern("", "x"))
  assert.ok(!matchPattern("v1.0", "v1x0"))
})

const now = new Date("2026-11-14T00:00:00Z")
const d = (days: number) => new Date(now.getTime() - days * 86_400_000)
const tags = [
  { name: "latest", pushedAt: d(1), lastPulledAt: d(1) },
  { name: "v3", pushedAt: d(5), lastPulledAt: null },
  { name: "v2", pushedAt: d(20), lastPulledAt: d(2) },
  { name: "v1", pushedAt: d(60), lastPulledAt: d(50) },
  { name: "dev-1", pushedAt: d(30), lastPulledAt: null },
]

test("keepLast alone deletes nothing without a delete rule", () => {
  assert.deepEqual(evaluatePolicy({ keepLast: 2 }, tags, now), [])
})

test("notPulledDays, with keepLast winning", () => {
  assert.deepEqual(evaluatePolicy({ notPulledDays: 25 }, tags, now).sort(), ["dev-1", "v1"])
  assert.deepEqual(evaluatePolicy({ notPulledDays: 40 }, tags, now), ["v1"])
  assert.deepEqual(evaluatePolicy({ notPulledDays: 25, keepLast: 2 }, tags, now).sort(), ["dev-1", "v1"])
  assert.deepEqual(evaluatePolicy({ notPulledDays: 25, keepLast: 4 }, tags, now), ["v1"])
})

test("delete pattern, keep pattern wins", () => {
  assert.deepEqual(evaluatePolicy({ deletePattern: "dev-*" }, tags, now), ["dev-1"])
  assert.deepEqual(evaluatePolicy({ deletePattern: "*", keepPattern: "v*,latest" }, tags, now), ["dev-1"])
})

test("untagged manifests", () => {
  const ms = [
    { digest: "a", createdAt: d(10), tagged: false },
    { digest: "b", createdAt: d(10), tagged: true },
    { digest: "c", createdAt: d(1), tagged: false },
  ]
  assert.deepEqual(untaggedToDelete({ untaggedDays: 7 }, ms, now), ["a"])
  assert.deepEqual(untaggedToDelete({}, ms, now), [])
})

test("maxRole picks the highest and ignores nulls", () => {
  assert.equal(maxRole(), null)
  assert.equal(maxRole(null, undefined), null)
  assert.equal(maxRole("read", null, "write"), "write")
  assert.equal(maxRole("write", "admin", "read"), "admin")
  assert.equal(maxRole("admin", "owner"), "owner")
  assert.ok(atLeast("admin", "write") && atLeast("write", "write") && !atLeast("read", "write") && !atLeast(null, "read"))
})

test("token scopes: push includes pull, delete includes push", () => {
  const ok = (a: "pull" | "push" | "delete") => (["pull", "push", "delete"] as const).filter((op) => scopeAllows(a, op))
  assert.deepEqual(ok("pull"), ["pull"])
  assert.deepEqual(ok("push"), ["pull", "push"])
  assert.deepEqual(ok("delete"), ["pull", "push", "delete"])
})
