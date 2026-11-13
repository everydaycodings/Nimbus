// Run: node --test lib/secrets/secrets-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  detectFormat,
  parseAny,
  parseEnv,
  parseJson,
  parseYaml,
  planImport,
  serialize,
  validateType,
} from "./format.ts"
import { expand, findRefs, selfId } from "./refs.ts"

test(".env: quotes, export, comments, multiline, bad lines", () => {
  const r = parseEnv(
    [
      "# note",
      "A=1",
      "export B = two words # trailing",
      `C="line1\\nline2 \\"q\\""`,
      "D='raw \\n $X'",
      'E="multi',
      'line"',
      "F=",
      "bad line",
      "9X=1",
    ].join("\n")
  )
  assert.deepEqual(r.pairs, [
    { key: "A", value: "1" },
    { key: "B", value: "two words" },
    { key: "C", value: 'line1\nline2 "q"' },
    { key: "D", value: "raw \\n $X" },
    { key: "E", value: "multi\nline" },
    { key: "F", value: "" },
  ])
  assert.equal(r.errors.length, 2)
})

test("JSON and YAML flatten nested keys; bad input reports an error", () => {
  const json = parseJson('{"db":{"host":"h","port":5432},"on":true,"list":[1,2],"n":null}')
  assert.deepEqual(json.pairs, [
    { key: "db_host", value: "h" },
    { key: "db_port", value: "5432" },
    { key: "on", value: "true" },
    { key: "list", value: "[1,2]" },
    { key: "n", value: "" },
  ])
  const y = parseYaml("db:\n  host: h\n  port: 1\nTOKEN: abc\nwhen: 2024-01-01\n")
  assert.deepEqual(y.pairs.map((p) => p.key), ["db_host", "db_port", "TOKEN", "when"])
  assert.equal(parseJson("{nope").errors.length, 1)
  assert.equal(parseJson("[1]").errors.length, 1)
  assert.equal(parseJson('{"a-b":1}').errors.length, 1)
})

test("detects the format and round-trips through every serializer", () => {
  assert.equal(detectFormat("{}", ""), "json")
  assert.equal(detectFormat("A=1", "x.txt"), "env")
  assert.equal(detectFormat("a: 1", "x.txt"), "yaml")
  assert.equal(detectFormat("a: 1", "c.yml"), "yaml")
  const pairs = [
    { key: "A", value: "plain" },
    { key: "B", value: 'sp ace "q"\nline' },
    { key: "C", value: "" },
  ]
  for (const f of ["env", "json", "yaml"] as const)
    assert.deepEqual(parseAny(serialize(pairs, f), `x.${f}`).pairs, pairs, f)
})

test("types validate on save", () => {
  assert.equal(validateType("number", "3.5"), null)
  assert.ok(validateType("number", "x"))
  assert.equal(validateType("bool", "TRUE"), null)
  assert.ok(validateType("bool", "yes"))
  assert.equal(validateType("url", "https://a.b/c"), null)
  assert.ok(validateType("url", "nope"))
  assert.equal(validateType("json", '{"a":1}'), null)
  assert.ok(validateType("json", "{"))
  assert.equal(validateType("pem", "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"), null)
  assert.ok(validateType("pem", "abc"))
  assert.equal(validateType("number", ""), null)
  assert.equal(validateType(null, "anything"), null)
})

test("import preview: new, changed, same, duplicate", () => {
  const rows = planImport(
    [
      { key: "A", value: "1" },
      { key: "B", value: "2" },
      { key: "C", value: "3" },
      { key: "A", value: "9" },
    ],
    new Map([["B", "2"], ["C", "old"], ["A", "1"]])
  )
  assert.deepEqual(rows.map((r) => r.status), ["duplicate", "same", "changed", "changed"])
})

const store: Record<string, string> = {
  "dev..HOST": "db.local",
  "dev..URL": "pg://${HOST}:5432",
  "prod..HOST": "db.prod",
  "dev.app.PORT": "8080",
  "dev..FULL": "${prod.HOST}/${dev.app.PORT}/${URL}",
  "dev..A": "${B}",
  "dev..B": "${C}",
  "dev..C": "x${A}",
  "dev..SELF": "${SELF}",
  "dev..LIT": "\\${HOST} ${NOPE}",
}
const lookup = (e: string, f: string, k: string) => store[`${e}.${f}.${k}`]
const dev = { env: "dev", folder: "" }

test("references expand across envs, folders and nested refs", () => {
  assert.deepEqual(findRefs("${A} ${prod.HOST} ${dev.app.PORT} \\${X}", dev).map((r) => `${r.env}/${r.folder}/${r.key}`), [
    "dev//A",
    "prod//HOST",
    "dev/app/PORT",
  ])
  const r = expand(store["dev..FULL"], dev, lookup, selfId(dev, "FULL"))
  assert.equal(r.value, "db.prod/8080/pg://db.local:5432")
  assert.deepEqual(r.errors, [])
})

test("cycles are detected, missing refs reported, escapes kept literal", () => {
  const c = expand(store["dev..A"], dev, lookup, selfId(dev, "A"))
  assert.equal(c.errors[0].kind, "cycle")
  assert.match(c.errors[0].message, /dev\.A → dev\.B → dev\.C → dev\.A/)
  assert.equal(expand("${SELF}", dev, lookup, selfId(dev, "SELF")).errors[0].kind, "cycle")
  const l = expand(store["dev..LIT"], dev, lookup)
  assert.equal(l.value, "${HOST} ${NOPE}")
  assert.deepEqual(l.errors.map((e) => e.kind), ["missing"])
  assert.equal(expand("${PORT}", { env: "dev", folder: "app" }, lookup).value, "8080")
})
