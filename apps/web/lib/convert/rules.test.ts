// Run: node --test lib/convert/rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { BUILTIN, cleanPreset, ffmpegArgs, inKind, outName, parseTime, progressOf, takes } from "./rules.ts"

const by = (id: string) => BUILTIN.find((b) => b.id === id)!.preset

test("names and kinds", () => {
  assert.equal(outName("Holiday.2024.mov", "480p", by("480p")), "Holiday.2024 (480p).mp4")
  assert.equal(outName("a.heic", "JPG", by("jpg")), "a (JPG).jpg")
  assert.equal(inKind("x.MP4"), "video")
  assert.equal(inKind("x.heic"), "image")
  assert.equal(inKind("x.txt"), null)
  assert.ok(takes(by("mp3"), "video") && takes(by("mp3"), "audio") && !takes(by("mp3"), "image"))
  assert.ok(takes(by("480p"), "video") && !takes(by("480p"), "audio") && !takes(by("webp"), "video"))
})

test("times and presets from untrusted input", () => {
  assert.equal(parseTime("1:30"), 90)
  assert.equal(parseTime("1:02:03"), 3723)
  assert.equal(parseTime(""), null)
  assert.equal(parseTime("abc"), null)
  assert.equal(cleanPreset({ kind: "video", codec: "vp9", container: "mp4" }), null)
  assert.equal(cleanPreset({ kind: "video", codec: "h264", container: "mp4", start: 10, end: 5 }), null)
  assert.deepEqual(cleanPreset({ kind: "image", format: "webp", quality: 500 }), { kind: "image", format: "webp", maxSide: undefined, quality: 85 })
})

test("ffmpeg arguments", () => {
  const v = ffmpegArgs(by("480p") as never, { input: "in.mov", out: "o.mp4", duration: 60 })
  assert.ok(v.includes("libx264") && v.includes("-crf") && v.includes("+faststart"))
  assert.ok(v.some((x) => x.startsWith("scale=-2:min(480")))
  const t = ffmpegArgs({ kind: "video", codec: "h264", container: "mp4", start: 5, end: 15 }, { input: "in", out: "o", duration: 60 })
  assert.deepEqual(t.slice(t.indexOf("-ss"), t.indexOf("-ss") + 2), ["-ss", "5"])
  assert.deepEqual(t.slice(t.indexOf("-t"), t.indexOf("-t") + 2), ["-t", "10"])
  const size = ffmpegArgs({ kind: "video", codec: "h264", container: "mp4", targetMb: 10 }, { input: "in", out: "o", duration: 80 })
  assert.equal(size[size.indexOf("-b:v") + 1], "896k") // 10 MB * 8192 / 80 s - 128
  assert.ok(!size.includes("-crf"))
  const hw = ffmpegArgs(by("720p") as never, { input: "in", out: "o", duration: 60, hw: "vaapi" })
  assert.ok(hw.includes("h264_vaapi") && hw.includes("-vaapi_device") && hw.some((x) => x.endsWith("hwupload")))
  const g = ffmpegArgs(by("gif") as never, { input: "in", out: "o.gif", duration: 600 })
  assert.deepEqual(g.slice(g.indexOf("-t"), g.indexOf("-t") + 2), ["-t", "30"])
  assert.ok(g.some((x) => x.includes("palettegen") && x.includes("paletteuse")))
  const a = ffmpegArgs(by("mp3") as never, { input: "in.mp4", out: "o.mp3", duration: 60 })
  assert.ok(a.includes("-vn") && a.includes("libmp3lame") && a.includes("192k"))
})

test("progress", () => {
  assert.deepEqual(progressOf({ out_time_us: "30000000", speed: "2.0x" }, 60), { pct: 50, eta: 15 })
  assert.equal(progressOf({ out_time_us: "N/A" }, 60), null)
  assert.equal(progressOf({ out_time_us: "99000000", speed: "1x" }, 60)?.pct, 99)
})
