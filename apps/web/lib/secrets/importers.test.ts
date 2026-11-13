// Run: node --test lib/secrets/importers.test.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { importFrom, parseCsv } from "./importers.ts"

const fx = (n: string) => readFileSync(new URL(`./fixtures/import/${n}`, import.meta.url), "utf8")

test("csv: quotes, doubled quotes, embedded newlines and a BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\n1,"x, ""y"""\n"two\nlines",3\r\n'), [["a", "b"], ["1", 'x, "y"'], ["two\nlines", "3"]])
})

test("infisical json: keys with values, bad key names reported, multi-env noted", () => {
  const r = importFrom("infisical", fx("infisical.json"), "infisical.json")
  assert.deepEqual(r.pairs.map((p) => p.key), ["DATABASE_URL", "STRIPE_SECRET_KEY", "MULTILINE"])
  assert.equal(r.pairs[2].value, "line one\nline two")
  assert.equal(r.entries.length, 0)
  assert.ok(r.errors.some((e) => e.includes("not a valid key name")))
})

test("infisical csv", () => {
  const r = importFrom("infisical", fx("infisical.csv"), "export.csv")
  assert.deepEqual(r.pairs, [
    { key: "API_URL", value: "https://api.example.test" },
    { key: "GREETING", value: 'hello, "world"' },
    { key: "NOTE_MULTI", value: "first\nsecond" },
  ])
})

test("doppler json skips its own DOPPLER_ keys and unwraps raw/computed", () => {
  const r = importFrom("doppler", fx("doppler.json"))
  assert.deepEqual(r.pairs.map((p) => p.key), ["API_KEY", "DEBUG", "DB_PASSWORD"])
  const api = importFrom("doppler", JSON.stringify({ secrets: { A: { raw: "${B}", computed: "resolved" } } }))
  assert.deepEqual(api.pairs, [{ key: "A", value: "resolved" }])
  assert.throws(() => importFrom("doppler", "[1,2]"), /Doppler/)
})

test("1password csv: logins, notes, env-style titles become secrets", () => {
  const r = importFrom("1password", fx("1password.csv"), "1p.csv")
  assert.deepEqual(r.pairs, [{ key: "OPENAI_API_KEY", value: "sk-live-abcdef0123456789" }])
  const gh = r.entries.find((e) => e.name === "GitHub")!
  assert.equal(gh.kind, "login")
  assert.equal(gh.data.username, "octo@example.test")
  assert.equal(gh.data.url, "https://github.com/login")
  assert.match(gh.data.totp, /^otpauth:/)
  assert.equal(r.entries.find((e) => e.name === "Recovery codes")!.data.body, "aaaa-bbbb\ncccc-dddd")
  assert.equal(r.entries.find((e) => e.name === "Wifi")!.kind, "login")
})

test("1password .1pux data: login, note, api credential; archived and cards skipped", () => {
  const r = importFrom("1password", fx("1password.1pux.json"), "export.data")
  assert.deepEqual(r.entries.map((e) => `${e.kind}:${e.name}`), ["login:GitHub", "note:House notes", "api_key:Deploy token"])
  const gh = r.entries[0].data
  assert.equal(gh.password, "hunter22-long-pass")
  assert.equal(gh.url, "https://github.com/login")
  assert.match(gh.totp, /JBSWY3DPEHPK3PXP/)
  assert.equal(r.entries[1].data.body, "Alarm code 4412\nGate 9981")
  assert.equal(r.entries[2].data.token, "tok_live_0123456789abcdef")
  assert.ok(r.errors.some((e) => e.includes("Visa")))
  assert.ok(!r.entries.some((e) => e.name === "Archived login"))
  assert.throws(() => importFrom("1password", "{}"), /1pux/)
})

test("bitwarden json: logins, notes, env-style secret, cards skipped, encrypted refused", () => {
  const r = importFrom("bitwarden", fx("bitwarden.json"), "bw.json")
  assert.deepEqual(r.pairs, [{ key: "STRIPE_WEBHOOK_SECRET", value: "whsec_0123456789abcdef" }])
  const jira = r.entries.find((e) => e.name === "Jira")!
  assert.equal(jira.data.url, "https://jira.example.test")
  assert.equal(jira.data.totp, "JBSWY3DPEHPK3PXP")
  assert.equal(jira.data.notes, "ticket system\nAccount id: A-77")
  assert.equal(r.entries.find((e) => e.name === "Server notes")!.kind, "note")
  assert.equal(r.errors.length, 2)
  assert.throws(() => importFrom("bitwarden", fx("bitwarden-encrypted.json"), "x.json"), /encrypted/)
})

test("keepass xml: nested groups, entities, history and recycle bin ignored", () => {
  const r = importFrom("keepass", fx("keepass.xml"), "db.xml")
  assert.deepEqual(r.pairs, [{ key: "SMTP_PASSWORD", value: "smtp-pass-123456" }])
  assert.deepEqual(r.entries.map((e) => e.name), ["Forum", "Plain note"])
  const forum = r.entries[0].data
  assert.equal(forum.password, "kp-pass-1234567")
  assert.equal(forum.url, "https://forum.example.test/?a=1&b=2")
  assert.equal(forum.notes, "Tom & Jerry's")
  assert.match(forum.totp, /^otpauth:/)
  assert.deepEqual(r.entries[1], { kind: "note", name: "Plain note", data: { body: "just a\nnote" } })
  assert.throws(() => importFrom("keepass", "<html/>"), /KeePass/)
})
