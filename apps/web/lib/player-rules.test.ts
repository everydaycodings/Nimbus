import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clock,
  defaultQuality,
  fadeGain,
  parseSpeed,
  playOrder,
  sleepLeftMs,
  sleepMinutes,
  sleepText,
  stepPos,
  usableQuality,
} from "./player-rules.ts"

test("sleep minutes: whole minutes from 1 to 1440", () => {
  assert.equal(sleepMinutes("20"), 20)
  assert.equal(sleepMinutes("0.4"), null)
  assert.equal(sleepMinutes("1441"), null)
  assert.equal(sleepMinutes(""), null)
  assert.equal(sleepMinutes("abc"), null)
})

test("sleep left: wall clock, or the media's remaining time at its speed", () => {
  assert.equal(sleepLeftMs({ kind: "at", at: 5000 }, 2000, 99, 1), 3000)
  assert.equal(sleepLeftMs({ kind: "end" }, 0, 30, 2), 15000)
  assert.equal(sleepLeftMs({ kind: "end" }, 0, NaN, 1), Infinity)
})

test("fade: full volume until 10 s are left, then down to silence", () => {
  assert.equal(fadeGain(60_000), 1)
  assert.equal(fadeGain(10_000), 1)
  assert.equal(fadeGain(5_000), 0.5)
  assert.equal(fadeGain(0), 0)
  assert.equal(fadeGain(-300), 0)
})

test("sleep text", () => {
  assert.equal(sleepText(12 * 60_000), "12 min")
  assert.equal(sleepText(45_000), "45 s")
})

test("quality: original unless save-data and 480 is ready; unready sizes fall back", () => {
  assert.equal(defaultQuality(false, [720, 480]), null)
  assert.equal(defaultQuality(true, [720, 480]), 480)
  assert.equal(defaultQuality(true, [720]), null)
  assert.equal(usableQuality(480, [720]), null)
  assert.equal(usableQuality(720, [720, 480]), 720)
  assert.equal(usableQuality(null, [720]), null)
})

test("speed parsing", () => {
  assert.equal(parseSpeed("1.5"), 1.5)
  assert.equal(parseSpeed(null), 1)
  assert.equal(parseSpeed("9"), 1)
})

test("clock", () => {
  assert.equal(clock(65), "1:05")
  assert.equal(clock(3723), "1:02:03")
  assert.equal(clock(NaN), "0:00")
})

test("play order: shuffle keeps the playing track first and uses every track once", () => {
  assert.deepEqual(playOrder(4, 2, false), { order: [0, 1, 2, 3], pos: 2 })
  const s = playOrder(5, 3, true, () => 0.3)
  assert.equal(s.pos, 0)
  assert.equal(s.order[0], 3)
  assert.deepEqual([...s.order].sort(), [0, 1, 2, 3, 4])
})

test("queue steps: repeat one only on auto, repeat all wraps, off stops", () => {
  assert.equal(stepPos(3, 1, 1, "one", true), 1)
  assert.equal(stepPos(3, 1, 1, "one", false), 2)
  assert.equal(stepPos(3, 2, 1, "off", true), null)
  assert.equal(stepPos(3, 2, 1, "all", true), 0)
  assert.equal(stepPos(3, 0, -1, "all", false), 2)
  assert.equal(stepPos(3, 0, -1, "off", false), null)
})
