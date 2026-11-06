import assert from "node:assert/strict"
import { test } from "node:test"

import { API_MAX, API_MIN, versionProblem } from "./api-version.ts"

test("versions inside the range are fine", () => {
  for (let v = API_MIN; v <= API_MAX; v++) assert.equal(versionProblem(v), null)
})

test("a newer server needs a newer app, an older one needs an update", () => {
  assert.equal(versionProblem(API_MAX + 1), "old-app")
  assert.equal(versionProblem(API_MIN - 1), "old-server")
})
