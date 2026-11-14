// Run: node --test lib/secrets/refs-deps.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAX_EXPANDED, dependents, expand, refGraph } from "./refs.ts"

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

test("doubling chains and deep nesting stop at the limits instead of blowing up", () => {
  // A0 = ${A1}${A1}, A1 = ${A2}${A2} ... 2^40 copies without the memo and the size cap.
  const store = new Map<string, string>()
  for (let i = 0; i < 40; i++) store.set(`A${i}`, `\${A${i + 1}}\${A${i + 1}}`)
  store.set("A40", "x".repeat(64))
  const t = Date.now()
  const r = expand(store.get("A0")!, { env: "dev", folder: "" }, (_e, _f, k) => store.get(k), "dev.A0")
  assert.ok(Date.now() - t < 1000)
  assert.ok(r.value.length <= MAX_EXPANDED + 1000)
  assert.equal(r.errors.filter((e) => e.kind === "limit").length, 1)

  const deep = new Map<string, string>()
  for (let i = 0; i < 5000; i++) deep.set(`D${i}`, `\${D${i + 1}}`)
  const d = expand("${D0}", { env: "dev", folder: "" }, (_e, _f, k) => deep.get(k))
  assert.match(d.errors[0].message, /nest more than 32/)

  // A diamond that stays small still expands fully, once per reference.
  const ok = expand("${B}-${B}", { env: "dev", folder: "" }, (_e, _f, k) => ({ B: "${C}${C}", C: "z" })[k])
  assert.equal(ok.value, "zz-zz")
  assert.deepEqual(ok.errors, [])
})
