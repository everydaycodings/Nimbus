// Run: node --test lib/secrets/health-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import * as h from "./health-rules.ts"

test("weak credentials are named, settings and strong values are not", () => {
  assert.equal(h.weakReason("DB_PASSWORD", "hunter2", "string"), "Only 7 characters")
  assert.equal(h.weakReason("ADMIN_PASSWORD", "Password1", null), "A common password")
  assert.equal(h.weakReason("API_TOKEN", "aaaaaaaaaaaaaaaaaaaa", null), "Repetitive, easy to guess")
  assert.equal(h.weakReason("SECRET", "onlylettersinhereok", null), "One kind of character")
  assert.equal(h.weakReason("SESSION_SECRET", "r7Xk29!dQw0vLz4mPa8Tb", null), null)
  assert.equal(h.weakReason("PORT", "3000", "number"), null)
  assert.equal(h.weakReason("LOG_LEVEL", "debug", null), null)
  assert.equal(h.weakReason("DB_PASSWORD", "${prod.DB_PASSWORD}", null), null)
  assert.equal(h.weakReason("DATABASE_PASSWORD_URL", "postgres://u:p@h/db", null), null)
  assert.equal(h.weakReason("TLS_KEY", "-----BEGIN PRIVATE KEY-----\nabc", null), null)
})

test("same value under different keys is reused, short or non-credential values are not", () => {
  const items = [
    { key: "A_SECRET", value: "r7Xk29!dQw0vLz4mPa8Tb", type: null, env: "dev" },
    { key: "B_TOKEN", value: "r7Xk29!dQw0vLz4mPa8Tb", type: null, env: "prod" },
    { key: "C_SECRET", value: "other-long-value-123", type: null, env: "dev" },
    { key: "HOST", value: "same-host-name-1", type: null, env: "dev" },
    { key: "HOST", value: "same-host-name-1", type: null, env: "prod" },
    { key: "S1_PASS", value: "short", type: null, env: "dev" },
    { key: "S2_PASS", value: "short", type: null, env: "prod" },
  ]
  const g = h.reusedGroups(items)
  assert.equal(g.length, 1)
  assert.deepEqual(g[0].map((x) => x.key), ["A_SECRET", "B_TOKEN"])
})

test("score falls with findings, capped per kind, never below 0", () => {
  const none = { weak: 0, reused: 0, old: 0, missing: 0, drift: 0, expiring: 0, unused: 0, leaks: 0 }
  assert.equal(h.healthScore(none), 100)
  assert.equal(h.healthScore({ ...none, weak: 2 }), 92)
  assert.equal(h.healthScore({ ...none, weak: 100 }), 75)
  assert.equal(h.healthScore({ weak: 99, reused: 99, old: 99, missing: 99, drift: 99, expiring: 99, unused: 99, leaks: 99 }), 0)
  assert.equal(h.grade(95), "Healthy")
  assert.equal(h.grade(10), "At risk")
})
