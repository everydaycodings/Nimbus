// Run: node --test lib/secrets/importers-zip.test.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { makeZip } from "client-zip"

import { importFrom } from "./importers.ts"
import { readPux } from "./importers-zip.ts"

test("a real zip with export.data and an attachment is read end to end", async () => {
  const data = readFileSync(new URL("./fixtures/import/1password.1pux.json", import.meta.url))
  const blob = await new Response(
    makeZip([
      { name: "export.attributes", input: JSON.stringify({ version: 3 }) },
      { name: "export.data", input: data },
      { name: "files/abc__photo.png", input: new Uint8Array([1, 2, 3]) },
    ])
  ).arrayBuffer()
  const r = importFrom("1password", await readPux(new Uint8Array(blob)), "x.1pux")
  assert.equal(r.entries.length, 3)
  await assert.rejects(readPux(new Uint8Array([1, 2, 3])), /\.1pux/)
  const none = await new Response(makeZip([{ name: "other.txt", input: "x" }])).arrayBuffer()
  await assert.rejects(readPux(new Uint8Array(none)), /export\.data/)
})
