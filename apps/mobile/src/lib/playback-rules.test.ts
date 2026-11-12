// Run: node --test src/lib/playback-rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { castRefreshIn, customMinutes, fadeGain, fadeStartsIn, keepsPosition, offerResume, offlineQuality, pickQuality } from "./playback-rules.ts"

test("Wi-Fi plays the original, mobile data the chosen copy", () => {
  assert.equal(pickQuality(false, 480, [720, 480]), "original")
  assert.equal(pickQuality(true, "original", [720, 480]), "original")
  assert.equal(pickQuality(true, 480, [720, 480]), 480)
  assert.equal(pickQuality(true, 720, [720, 480]), 720)
})

test("mobile data falls back to what is ready", () => {
  assert.equal(pickQuality(true, 720, [480]), 480)
  assert.equal(pickQuality(true, 480, [720]), 720)
  assert.equal(pickQuality(true, 480, []), "original")
})

test("offline saves the smallest copy for Data-saver, else the original", () => {
  assert.equal(offlineQuality("original", [720, 480]), "original")
  assert.equal(offlineQuality("data-saver", [720, 480]), 480)
  assert.equal(offlineQuality("data-saver", [720]), 720)
  assert.equal(offlineQuality("data-saver", []), "original")
})

test("custom minutes", () => {
  assert.equal(customMinutes("20"), 20)
  assert.equal(customMinutes(" 90 "), 90)
  assert.equal(customMinutes("0"), null)
  assert.equal(customMinutes("721"), null)
  assert.equal(customMinutes("1.5"), null)
  assert.equal(customMinutes(""), null)
})

test("the sleep fade takes the last ten seconds", () => {
  assert.equal(fadeGain(60_000), 1)
  assert.equal(fadeGain(10_000), 1)
  assert.equal(fadeGain(5_000), 0.5)
  assert.equal(fadeGain(-50), 0)
  assert.equal(fadeStartsIn(100_000, 0), 90_000)
  assert.equal(fadeStartsIn(5_000, 0), 0)
})

test("the cast URL is renewed before it lapses", () => {
  const h = 3_600_000
  assert.equal(castRefreshIn(h, 0), h - 600_000)
  assert.equal(castRefreshIn(400_000, 0), 200_000)
  assert.equal(castRefreshIn(10_000, 0), 30_000)
  assert.equal(castRefreshIn(0, 5_000), 30_000)
})

test("resume is offered only for long media left in the middle", () => {
  assert.equal(offerResume(2530, 4000), true)
  assert.equal(offerResume(2530, 500), false)
  assert.equal(offerResume(3, 4000), false)
  assert.equal(offerResume(3995, 4000), false)
  assert.equal(offerResume(null, 4000), false)
  assert.equal(keepsPosition(601), true)
  assert.equal(keepsPosition(600), false)
})
