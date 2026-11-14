// Run: node --test lib/secrets/refs-deps.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { dependents, refGraph } from "./refs.ts"

const item = (env: string, value: string, folder = "") => ({ scope: { env, folder }, value })

test("graph keeps only cross-env references", () => {
  const g = refGraph([
    item("dev", "${prod.DB_URL}"),
    item("dev", "${LOCAL} ${staging.api.KEY} \\${qa.KEY}"),
    item("prod", "plain"),
    item("qa", "${qa.SELF}"),
  ])
  assert.deepEqual([...g.keys()], ["dev"])
  assert.deepEqual([...g.get("dev")!].sort(), ["prod", "staging"])
})

test("dependents are transitive and exclude the changed env", () => {
  const g = refGraph([item("staging", "${prod.A}"), item("dev", "${staging.B}"), item("qa", "x")])
  assert.deepEqual(dependents(g, ["prod"]).sort(), ["dev", "staging"])
  assert.deepEqual(dependents(g, ["dev"]), [])
  assert.deepEqual(dependents(g, ["staging", "prod"]), ["dev"])
})

test("cycles end", () => {
  const g = refGraph([item("a", "${b.X}"), item("b", "${c.X}"), item("c", "${a.X}"), item("d", "${c.X}")])
  assert.deepEqual(dependents(g, ["a"]).sort(), ["b", "c", "d"])
  assert.deepEqual(dependents(g, ["d"]), [])
})
