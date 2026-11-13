// Text on screen in a video: a frame every 5 s plus scene changes, scaled to
// 1280 wide, read by OCR; frames with the same text merge into one part.
// Same nice'd ffmpeg as scripts/transcode.ts. Needs ffmpeg in the image.
import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { ocrLines, type Part } from "../lib/extract.ts"

const run = promisify(execFile)

const words = (s: string) =>
  new Set(s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])

// Near-identical: most of the words are shared.
function same(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  const both = [...x].filter((w) => y.has(w)).length
  return both / Math.max(1, x.size + y.size - both) >= 0.7
}

// Consecutive frames with the same text become one part, at the first frame's time.
export function mergeFrames(frames: { tMs: number; body: string }[]): Part[] {
  const out: Part[] = []
  for (const f of frames) {
    const last = out.at(-1)
    if (last && same(last.body, f.body)) {
      if (f.body.length > last.body.length) last.body = f.body
    } else out.push({ kind: "time", tMs: f.tMs, body: f.body })
  }
  return out
}

// Frames of a video into `dir`: one every 5 s plus scene changes, 1280 wide, for
// the first `maxMin` minutes (and at most `max` frames). Shared with scripts/ml.ts.
export async function sampleFrames(url: string, maxMin: number, dir: string, max = 100_000) {
  const { stderr } = await run(
    "nice",
    [
      "-n", "19", "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "info", "-y",
      "-t", String(maxMin * 60), "-i", url, "-an", "-sn", "-dn",
      "-vf", "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,5)+gt(scene\\,0.3)',scale=1280:-2,showinfo",
      "-vsync", "vfr", "-frames:v", String(max), "-q:v", "4", join(dir, "frame_%05d.jpg"),
    ],
    { timeout: 6 * 3600_000, maxBuffer: 256 * 1024 * 1024 }
  )
  // showinfo prints one line per kept frame, in order.
  const times = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000))
  const files = (await readdir(dir)).filter((n) => n.endsWith(".jpg")).sort()
  return files.map((name, i) => ({ path: join(dir, name), tMs: times[i] ?? 0 }))
}

// `url`: the video (a presigned URL works). Reads the first `maxMin` minutes.
export async function videoParts(url: string, langs: string, maxMin: number) {
  const dir = await mkdtemp(join(tmpdir(), "nimbus-ocr-"))
  try {
    const frames: { tMs: number; body: string }[] = []
    for (const f of await sampleFrames(url, maxMin, dir)) {
      const lines = await ocrLines(await readFile(f.path), langs)
      const body = lines.map((l) => l.body).join("\n")
      if (body) frames.push({ tMs: f.tMs, body })
    }
    return mergeFrames(frames)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
