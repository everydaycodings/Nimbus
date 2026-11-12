import assert from "node:assert/strict"
import { test } from "node:test"

import {
  castLifetime,
  castableOriginal,
  copyHeight,
  embeddedJpeg,
  parseQuality,
  renditionKey,
  renditionsToMake,
  resumeAction,
  sidecarLabel,
  srtToVtt,
} from "./playback-rules.ts"

test("which copies are made", () => {
  assert.deepEqual(renditionsToMake(1080, "h264"), [720, 480])
  assert.deepEqual(renditionsToMake(1080, "hevc"), [720, 480])
  assert.deepEqual(renditionsToMake(2160, "h264"), [720, 480])
  assert.deepEqual(renditionsToMake(720, "h264"), [480])
  assert.deepEqual(renditionsToMake(720, "hevc"), [720, 480])
  assert.deepEqual(renditionsToMake(600, "h264"), [480])
  assert.deepEqual(renditionsToMake(600, "hevc"), [720, 480])
  assert.deepEqual(renditionsToMake(480, "h264"), [])
  assert.deepEqual(renditionsToMake(360, "h264"), [])
  assert.deepEqual(renditionsToMake(360, "mpeg4"), [720])
})

test("copies never upscale and have an even height", () => {
  assert.equal(copyHeight(720, 1080), 720)
  assert.equal(copyHeight(720, 361), 360)
  assert.equal(copyHeight(480, 2160), 480)
})

test("quality query and keys", () => {
  assert.equal(parseQuality("480"), 480)
  assert.equal(parseQuality("720"), 720)
  assert.equal(parseQuality("1080"), null)
  assert.equal(parseQuality(null), null)
  assert.equal(renditionKey("abc", 720), "renditions/abc.720.mp4")
})

test("cast URL lifetime is duration plus an hour, within bounds", () => {
  assert.equal(castLifetime(7200), 10800)
  assert.equal(castLifetime(10.2), 3611)
  assert.equal(castLifetime(null), 4 * 3600)
  assert.equal(castLifetime(99 * 24 * 3600), 7 * 24 * 3600)
})

test("resume is for media over ten minutes", () => {
  assert.equal(resumeAction(300, 600), "skip")
  assert.equal(resumeAction(300, 601), "save")
  assert.equal(resumeAction(2, 3000), "clear")
  assert.equal(resumeAction(2980, 3000), "clear")
  assert.equal(resumeAction(2960, 3000), "save")
})

test("what a Chromecast plays as is", () => {
  assert.equal(castableOriginal("a.mp4", "video", "h264"), true)
  assert.equal(castableOriginal("a.mp4", "video", null), true)
  assert.equal(castableOriginal("a.mp4", "video", "hevc"), false)
  assert.equal(castableOriginal("a.mkv", "video", "h264"), false)
  assert.equal(castableOriginal("a.avi", "video", null), false)
  assert.equal(castableOriginal("a.flac", "audio", null), true)
  assert.equal(castableOriginal("a.wma", "audio", null), false)
  assert.equal(castableOriginal("a.pdf", "pdf", null), false)
})

test("srt becomes webvtt", () => {
  assert.equal(
    srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nHi, there\r\n"),
    "WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nHi, there\n"
  )
})

test("sidecar names", () => {
  assert.equal(sidecarLabel("Movie.mkv", "Movie.srt"), "Subtitles")
  assert.equal(sidecarLabel("Movie.mkv", "movie.en.vtt"), "en")
  assert.equal(sidecarLabel("Movie.mkv", "Movie.pt-BR.srt"), "pt-BR")
  assert.equal(sidecarLabel("Movie.mkv", "Other.srt"), null)
  assert.equal(sidecarLabel("Movie.mkv", "Movie.txt"), null)
})

test("the biggest JPEG inside a RAW file", async () => {
  const sharp = (await import("sharp")).default
  const mk = (n: number) =>
    sharp({ create: { width: n, height: n, channels: 3, background: "#888" } }).jpeg().toBuffer()
  const [small, big] = [await mk(16), await mk(64)]
  const raw = Buffer.concat([Buffer.from("II*\0junk"), small, Buffer.from("xx"), big, Buffer.from("tail")])
  assert.deepEqual(Buffer.from(embeddedJpeg(raw)!), big)
  assert.equal(embeddedJpeg(Buffer.from("no jpeg here")), null)
})
