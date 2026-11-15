import assert from "node:assert/strict"
import { test } from "node:test"

import { badgeSvg } from "./badge-svg.ts"
import { since } from "./build-view.ts"

test("badge svg carries label and value, escaped", () => {
  const svg = badgeSvg({ label: "build", value: 'pass"<ing', color: "#2f855a" })
  assert.match(svg, /aria-label="build: pass&#34;&#60;ing"/)
  assert.doesNotMatch(svg, /<ing/)
  assert.match(svg, /^<svg /)
})

test("since counts whole minutes", () => {
  assert.equal(since(40_000), "<1m")
  assert.equal(since(7 * 60_000), "7m")
  assert.equal(since(135 * 60_000), "2h 15m")
})
