import assert from "node:assert/strict"
import test from "node:test"

import { evaluatePolicy } from "./rules.ts"
import { selectCleanup } from "./cleanup.ts"
import { parseUpstream, pickTags, validRegex } from "./tools-rules.ts"

test("parseUpstream: Docker Hub, other hosts, tags refused", () => {
  assert.deepEqual(parseUpstream("alpine"), { url: "https://registry-1.docker.io", host: "registry-1.docker.io", path: "library/alpine" })
  assert.deepEqual(parseUpstream("docker.io/bitnami/redis"), { url: "https://registry-1.docker.io", host: "registry-1.docker.io", path: "bitnami/redis" })
  assert.deepEqual(parseUpstream("ghcr.io/org/app"), { url: "https://ghcr.io", host: "ghcr.io", path: "org/app" })
  assert.deepEqual(parseUpstream("http://localhost:5000/x/y"), { url: "http://localhost:5000", host: "localhost:5000", path: "x/y" })
  assert.match((parseUpstream("alpine:3.20") as { error: string }).error, /tag out/)
  assert.match((parseUpstream("ghcr.io/org/app:1") as { error: string }).error, /tag out/)
  assert.ok("error" in parseUpstream("alpine@sha256:abc"))
  assert.ok("error" in parseUpstream("Bad Name"))
  assert.ok("error" in parseUpstream(""))
})

test("pickTags: lists as typed, globs by version order, capped", () => {
  assert.deepEqual(pickTags("3.20, latest", [], 5), ["3.20", "latest"])
  assert.deepEqual(pickTags("3.*", ["3.9", "3.10", "3.2", "edge", "4.0"], 2), ["3.10", "3.9"])
  assert.deepEqual(pickTags("latest,3.*", ["3.1", "3.2"], 2), ["latest", "3.2"])
  assert.deepEqual(pickTags("bad tag!", [], 5), [])
})

test("validRegex", () => {
  assert.equal(validRegex("^v\\d+$"), null)
  assert.ok(validRegex("("))
  assert.ok(validRegex("a".repeat(101)))
})

const day = 86_400_000
const now = new Date("2026-01-01T00:00:00Z")
const t = (name: string, ago: number) => ({ name, pushedAt: new Date(now.getTime() - ago * day), lastPulledAt: null })

test("olderThanDays deletes old tags; keepLast and keepRegex save them", () => {
  const tags = [t("a", 1), t("b", 40), t("c", 50), t("v1", 90)]
  assert.deepEqual(evaluatePolicy({ olderThanDays: 30 }, tags, now).sort(), ["b", "c", "v1"])
  assert.deepEqual(evaluatePolicy({ olderThanDays: 30, keepLast: 3 }, tags, now), ["v1"])
  const sel = selectCleanup({ olderThanDays: 30, keepRegex: "^v\\d" }, tags, [], null, now)
  assert.deepEqual(sel.tags.sort(), ["b", "c"])
  const last = selectCleanup({ keepLast: 1, keepRegex: "^v" }, tags, [], null, now)
  assert.deepEqual(last.tags.sort(), ["b", "c"])
})
