import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_TEMPLATE, ENGINES, checkSyntax, clampTtl, holes, leaseUrl, newPassword, newUsername,
  parseMongo, parseTtl, quoteIdent, quoteLiteral, render, splitRedis, splitSql, validateTemplate,
} from "./dyn-rules.ts"

const V = { username: "nim_0123456789ab", password: "Abcdefghij0123456789ABCDEFGHIJ01", expiry: "2030-01-01T00:00:00Z" }

test("templates render with all three placeholders", () => {
  const out = render(`CREATE ROLE "{{username}}" PASSWORD '{{ password }}' VALID UNTIL '{{expiry}}'`, V)
  assert.equal(out, `CREATE ROLE "nim_0123456789ab" PASSWORD '${V.password}' VALID UNTIL '2030-01-01T00:00:00Z'`)
})

test("a value that could break out of its quotes never reaches a statement", () => {
  for (const username of [`x"; DROP ROLE postgres; --`, "a'b", "a b", "", "a".repeat(64), "a;b", "x\u0000"])
    assert.throws(() => render("{{username}}", { ...V, username }), /user name/)
  for (const password of [`p'; DROP`, "short", "has space padding 0123456789", "p\\'x00000000000000000000"])
    assert.throws(() => render("{{password}}", { ...V, password }), /password/)
  assert.throws(() => render("{{expiry}}", { ...V, expiry: "2030-01-01'; --" }), /expiry/)
  assert.throws(() => render("{{password}}", { username: V.username }), /password/)
})

test("generated names and passwords satisfy the patterns", () => {
  for (let i = 0; i < 50; i++) render("{{username}}{{password}}", { username: newUsername(), password: newPassword() })
  assert.notEqual(newPassword(), newPassword())
  assert.match(newUsername(), /^nim_[0-9a-f]{12}$/)
})

test("template checks", () => {
  assert.equal(validateTemplate("CREATE USER {{username}} {{password}}", "create"), null)
  assert.match(validateTemplate("CREATE USER {{user}} {{password}}", "create")!, /isn't a placeholder/)
  assert.match(validateTemplate("DROP USER x", "revoke")!, /\{\{username\}\}/)
  assert.match(validateTemplate("CREATE USER {{username}}", "create")!, /\{\{password\}\}/)
  assert.match(validateTemplate("DROP USER {{username}} {{password}}", "revoke")!, /password/)
  assert.match(validateTemplate("DROP {{username", "revoke")!, /closed/)
  assert.deepEqual([...holes("{{username}} {{ password }}")].sort(), ["password", "username"])
})

test("defaults are valid for every engine", () => {
  for (const e of ENGINES) {
    assert.equal(validateTemplate(DEFAULT_TEMPLATE[e].create, "create"), null)
    assert.equal(validateTemplate(DEFAULT_TEMPLATE[e].revoke, "revoke"), null)
    checkSyntax(e, DEFAULT_TEMPLATE[e].create)
    checkSyntax(e, DEFAULT_TEMPLATE[e].revoke)
  }
  assert.throws(() => checkSyntax("mongodb", "{{username}} {{password}}"), /JSON/)
})

test("identifier and literal quoting", () => {
  assert.equal(quoteIdent("postgres", `a"b`), `"a""b"`)
  assert.equal(quoteIdent("mysql", "a`b"), "`a``b`")
  assert.equal(quoteLiteral("postgres", "it's"), "'it''s'")
  assert.equal(quoteLiteral("mysql", "a\\b'c"), "'a\\\\b''c'")
  assert.equal(quoteLiteral("postgres", "a\\b"), "E'a\\\\b'")
  assert.throws(() => quoteIdent("postgres", "a\0b"))
  assert.throws(() => quoteLiteral("mysql", "a\0b"))
  // A hostile name stays one identifier / one literal.
  assert.equal(quoteIdent("postgres", `x"; DROP ROLE y; --`), `"x""; DROP ROLE y; --"`)
  assert.equal(quoteLiteral("postgres", `x'; DROP ROLE y; --`), `'x''; DROP ROLE y; --'`)
})

test("statement splitting", () => {
  assert.deepEqual(splitSql(`a; b 'x;y'; -- c;d\n"q;r";`), ["a", "b 'x;y'", `"q;r"`])
  assert.deepEqual(splitRedis(`ACL SETUSER u on >pw "~key *" +@read\n\n# c\nACL DELUSER u`), [["ACL", "SETUSER", "u", "on", ">pw", "~key *", "+@read"], ["ACL", "DELUSER", "u"]])
  assert.deepEqual(parseMongo(`[{"a":1},{"b":2}]`), [{ a: 1 }, { b: 2 }])
  assert.throws(() => parseMongo(`[]`))
  assert.throws(() => parseMongo(`nope`))
})

test("ttl parsing and clamping", () => {
  assert.equal(parseTtl("90"), 90)
  assert.equal(parseTtl("30m"), 1800)
  assert.equal(parseTtl("2h"), 7200)
  assert.equal(parseTtl("7d"), 604800)
  assert.equal(parseTtl(120), 120)
  for (const bad of ["", "0", "-5", "1.5h", "h", "abc", 0, 1.5, null]) assert.equal(parseTtl(bad), null)
  assert.equal(clampTtl(10, 3600), 60)
  assert.equal(clampTtl(99999, 3600), 3600)
  assert.equal(clampTtl(600, 3600), 600)
})

test("connection urls", () => {
  const l = { host: "db", port: 5432, database: "app", username: "u", password: "p@ss/w", tls: true }
  assert.equal(leaseUrl("postgres", l), "postgres://u:p%40ss%2Fw@db:5432/app?sslmode=require")
  assert.equal(leaseUrl("redis", { ...l, tls: false }), "redis://u:p%40ss%2Fw@db:5432")
})
