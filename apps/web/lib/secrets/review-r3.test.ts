// Run: node --test lib/secrets/review-r3.test.ts
// Parser limits and shell-safe .env output.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import { parseEnv, parseJson, parseYaml, serialize } from "./format.ts"
import { importFrom } from "./importers.ts"

const quick = (fn: () => void) => {
  const t = Date.now()
  fn()
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`)
}

test("an unclosed quote in a big .env is one pass, not one per line", () => {
  const text = 'A="never closed\n' + "B=1\n".repeat(200_000)
  quick(() => assert.match(parseEnv(text).errors[0], /unclosed quote/))
  // An escaped backslash at a line end doesn't escape the line break; multiline still joins.
  assert.deepEqual(parseEnv('A="a\\\\\nb"\nB="1\n2"').pairs, [{ key: "A", value: "a\\\nb" }, { key: "B", value: "1\n2" }])
})

test("YAML aliases are refused (billion laughs), JSON __proto__ pollutes nothing", () => {
  const rows = ['a: &a ["x","x","x","x","x","x","x","x","x"]']
  for (let i = 1; i < 9; i++) rows.push(`${"bcdefghij"[i - 1]}: &${"bcdefghij"[i - 1]} [${Array(9).fill(`*${"abcdefghij"[i - 1]}`).join(",")}]`)
  quick(() => assert.match(parseYaml(rows.join("\n")).errors[0], /Aliases/))
  const j = parseJson('{"__proto__": {"polluted": "yes"}, "OK": "1"}')
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  assert.ok(j.pairs.some((p) => p.key === "OK"))
})

test("KeePass XML with thousands of groups or unclosed tags stays fast", () => {
  const groups = "<Group><Name>g</Name>".repeat(20_000) + "</Group>".repeat(20_000)
  quick(() => assert.throws(() => importFrom("keepass", `<KeePassFile><Root>${groups}</Root></KeePassFile>`), /Nothing to import/))
  const entry = `<Entry>${"<String><Key>Title".repeat(20_000)}</Entry>`
  quick(() => importFrom("keepass", `<KeePassFile><Root><Group><Name>g</Name>${entry}</Group></Root></KeePassFile>`))
})

test(".env export is safe to source in a shell and round-trips", () => {
  const pairs = [
    { key: "CMD", value: "$(touch /nonexistent/pwned) `id` ${HOME}" },
    { key: "Q", value: 'a"b\\c\nd' },
  ]
  const text = serialize(pairs, "env")
  assert.deepEqual(parseEnv(text).pairs, pairs)
  // Newlines stay \n escapes in a shell (dotenv style); everything else comes back exact.
  const out = execFileSync("bash", ["-c", `set -a; eval "$1"; printf '%s\\0%s' "$CMD" "$Q"`, "_", text], { encoding: "utf8" })
  assert.deepEqual(out.split("\0"), [pairs[0].value, 'a"b\\c\\nd'])
})
