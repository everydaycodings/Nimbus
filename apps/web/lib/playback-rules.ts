// Pure playback rules: which data-saver copies to make, how long a cast URL lives,
// when a position is worth saving, what a Chromecast plays, SRT to WebVTT. No `@/`
// imports, so the app, the worker (scripts/transcode.ts) and playback-rules.test.ts share it.

export const QUALITIES = [720, 480] as const
export type Quality = (typeof QUALITIES)[number]

// Where a copy lives: next to the thumbnails, one object per source key and size.
// The ~1920 px JPEG a TV shows for a photo, made on first cast and kept.
export const PREVIEW_PX = 1920
export const previewKey = (key: string) => `previews/${key}.${PREVIEW_PX}.jpg`
export const RAW_EXT = /\.(dng|cr2|cr3|nef|nrw|arw|orf|rw2|raf|pef|srw|3fr|erf|mrw)$/i

export const renditionKey = (key: string, height: number) =>
  `renditions/${key}.${height}.mp4`

// ?quality= on the stream routes: 480 or 720, anything else is the original.
export const parseQuality = (raw: string | null | undefined): Quality | null =>
  raw === "480" ? 480 : raw === "720" ? 720 : null

// Which sizes get a copy. Never upscales. An H.264 original at or below a size is
// already as good as the copy; any other codec is re-encoded so every device can
// play it, at the original's size when that's smaller (the 720 slot covers it, so
// the 480 slot is skipped once the original fits in it).
export function renditionsToMake(height: number, codec: string) {
  return QUALITIES.filter(
    (q) => !(height <= q && (codec === "h264" || q === 480))
  )
}

// The height ffmpeg scales a copy to, always even.
export const copyHeight = (slot: number, height: number) =>
  Math.floor(Math.min(slot, height) / 2) * 2

// Cast URLs last the media's length plus an hour, so a paused film still plays; S3 allows 7 days.
const HOUR = 3600
export const castLifetime = (durationSec: number | null | undefined) =>
  Math.min(
    7 * 24 * HOUR,
    Math.max(HOUR, Math.ceil(durationSec && durationSec > 0 ? durationSec : 3 * HOUR) + HOUR)
  )

// Positions are kept only for long media, and cleared near the end.
export const RESUME_MIN_SEC = 10 * 60
export const RESUME_END_SEC = 30
export function resumeAction(positionSec: number, durationSec: number) {
  if (durationSec <= RESUME_MIN_SEC) return "skip" as const
  if (positionSec < 5 || positionSec >= durationSec - RESUME_END_SEC)
    return "clear" as const
  return "save" as const
}

// What a Chromecast plays as is. Video also needs a codec it decodes (an unprobed file gets the benefit of the doubt).
const CAST_VIDEO = /\.(mp4|m4v|webm)$/i
const CAST_VIDEO_CODECS = ["h264", "vp8", "vp9"]
const CAST_AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i
export function castableOriginal(
  name: string,
  kind: string | null,
  codec: string | null
) {
  if (kind === "video")
    return CAST_VIDEO.test(name) && (!codec || CAST_VIDEO_CODECS.includes(codec))
  if (kind === "audio") return CAST_AUDIO.test(name)
  return false
}

// SubRip to WebVTT: a header, and the comma in the timestamps becomes a dot.
export function srtToVtt(srt: string) {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
  return `WEBVTT\n\n${body.trim()}\n`
}

// movie.mkv: movie.srt, movie.en.vtt ... Returns the label ("en", or "Subtitles"), or null if it isn't one.
export function sidecarLabel(video: string, other: string) {
  const base = video.replace(/\.[^.]+$/, "").toLowerCase()
  const m = /^(.*?)(?:\.([a-z]{2,3}(?:-[a-z]{2,4})?))?\.(srt|vtt)$/i.exec(other)
  if (!m || m[1].toLowerCase() !== base) return null
  return m[2] ?? "Subtitles"
}

// Text subtitle codecs ffmpeg can turn into WebVTT; picture ones (PGS, DVD) can't.
export const TEXT_SUBS = ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]

// The largest JPEG inside a RAW file (they all carry one), found by its markers.
// ponytail: scans bytes for FFD8..FFD9 pairs; a RAW with only a tiny preview yields a small image.
export function embeddedJpeg(b: Uint8Array) {
  let best: Uint8Array | null = null
  for (let i = b.indexOf(0xff); i >= 0 && i < b.length - 3; i = b.indexOf(0xff, i + 1)) {
    if (b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue
    let end = i + 2
    for (let j = b.indexOf(0xff, end); j >= 0 && j < b.length - 1; j = b.indexOf(0xff, j + 1))
      if (b[j + 1] === 0xd9) { end = j + 2; if (end - i > (best?.length ?? 0)) best = b.subarray(i, end); break }
  }
  return best
}
