import assert from "node:assert/strict"
import { test } from "node:test"

import { licenceFiles, licenseId, NATIVE, walk } from "../../scripts/licences.mjs"
import { filterLicences } from "./licences.ts"

test("licence ids come from every shape package.json uses", () => {
  assert.equal(licenseId({ license: "MIT" }), "MIT")
  assert.equal(licenseId({ license: { type: "ISC" } }), "ISC")
  assert.equal(licenseId({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), "MIT OR Apache-2.0")
  assert.equal(licenseId({}), "Unknown")
})

test("licence files are picked by name, licence before notice", () => {
  assert.deepEqual(licenceFiles(["index.js", "NOTICE", "README.md", "LICENSE.md", "LICENCE-MIT", "license.json", "COPYING"]), ["COPYING", "LICENCE-MIT", "LICENSE.md", "NOTICE"])
})

test("the walk follows dependencies up the tree and skips dev ones", () => {
  const files: Record<string, object> = {
    "/a/package.json": { name: "a", dependencies: { b: "1" }, devDependencies: { dev: "1" } },
    "/a/node_modules/b/package.json": { name: "b", dependencies: { c: "1" } },
    "/node_modules/c/package.json": { name: "c" },
    "/node_modules/dev/package.json": { name: "dev" },
  }
  const found = walk(["/a"], ((p: string) => JSON.stringify(files[p])) as never, ((p: string) => p in files) as never)
  assert.deepEqual(found.map(([, p]: [string, { name: string }]) => p.name), ["a", "b", "c"])
})

test("the native list carries a licence text we ship", () => {
  assert.ok(NATIVE.every(([, , id]: string[]) => id === "MIT" || id === "Apache-2.0"))
})

test("search matches name or licence, any case", () => {
  const list = [
    { name: "react", version: "1", license: "MIT", text: 0 },
    { name: "okhttp", version: "4", license: "Apache-2.0", text: 1 },
  ]
  assert.equal(filterLicences(list, "  REA ").length, 1)
  assert.equal(filterLicences(list, "apache")[0].name, "okhttp")
  assert.equal(filterLicences(list, "").length, 2)
})
