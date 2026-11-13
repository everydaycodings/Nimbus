// Run: node --test src/lib/captions.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { cueAt, parseVtt } from "./captions.ts"

const vtt = `WEBVTT

NOTE a comment

1
00:00:01.000 --> 00:00:03.500 align:start
Hello <b>there</b>

00:01:02.5 --> 00:01:04.000
Second
line

STYLE
::cue { color: red }
`

test("parses times, strips tags and keeps multi-line text", () => {
  assert.deepEqual(parseVtt(vtt), [
    { start: 1, end: 3.5, text: "Hello there" },
    { start: 62.5, end: 64, text: "Second\nline" },
  ])
})

test("cueAt finds the cue under the playhead", () => {
  const cues = parseVtt(vtt)
  assert.equal(cueAt(cues, 0.5), null)
  assert.equal(cueAt(cues, 2)?.text, "Hello there")
  assert.equal(cueAt(cues, 3.5), null)
  assert.equal(cueAt(cues, 63)?.text, "Second\nline")
  assert.equal(cueAt([], 1), null)
})
