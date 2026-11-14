// The in-app guide reads content/secrets-guide.md; docs/secrets.md is the same text for GitHub.
// Run: node --test lib/secrets/guide-sync.test.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("docs/secrets.md and content/secrets-guide.md are identical", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8")
  assert.equal(read("../../content/secrets-guide.md"), read("../../../../docs/secrets.md"))
})
