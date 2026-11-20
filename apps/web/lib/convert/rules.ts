// Media Converter rules shared by the page, the app and the worker (scripts/convert.ts). Plain module: no imports from the app.
import { AUDIO, IMAGE, VIDEO } from "../file-rules.ts"

export type Hw = "off" | "vaapi" | "nvenc"
export type AudioFormat = "mp3" | "m4a" | "opus" | "flac" | "wav"
export type ImageFormat = "jpg" | "png" | "webp" | "avif"
export type Preset =
  | { kind: "video"; codec: "h264" | "h265" | "av1"; container: "mp4" | "mkv"; height?: number; crf?: number; targetMb?: number; start?: number; end?: number }
  | { kind: "gif"; width: number; fps: number; start?: number; end?: number }
  | { kind: "audio"; format: AudioFormat; kbps: number }
  | { kind: "image"; format: ImageFormat; maxSide?: number; quality: number }
export type InKind = "video" | "audio" | "image"

export const HEIC = /\.(heic|heif)$/i
export const GIF_MAX_SECONDS = 30
export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const
export const QUALITY = [["High", 20], ["Balanced", 23], ["Small", 28]] as const
export const AUDIO_KBPS = [64, 96, 128, 192, 256, 320] as const

export type Builtin = { id: string; name: string; text: string; preset: Preset }
export const BUILTIN: Builtin[] = [
  { id: "480p", name: "480p", text: "Small MP4, good for phones and sharing", preset: { kind: "video", codec: "h264", container: "mp4", height: 480, crf: 24 } },
  { id: "720p", name: "720p", text: "MP4 at HD", preset: { kind: "video", codec: "h264", container: "mp4", height: 720, crf: 23 } },
  { id: "1080p", name: "1080p", text: "MP4 at full HD", preset: { kind: "video", codec: "h264", container: "mp4", height: 1080, crf: 22 } },
  { id: "h265", name: "Smaller (H.265)", text: "Same size on screen, about half the file", preset: { kind: "video", codec: "h265", container: "mp4", crf: 28 } },
  { id: "gif", name: "GIF", text: `Looping animation of the first ${GIF_MAX_SECONDS} seconds`, preset: { kind: "gif", width: 480, fps: 12 } },
  { id: "mp3", name: "MP3", text: "MP3 at 192 kbps; from a video it extracts the sound", preset: { kind: "audio", format: "mp3", kbps: 192 } },
  { id: "m4a", name: "M4A", text: "AAC at 128 kbps; from a video it extracts the sound", preset: { kind: "audio", format: "m4a", kbps: 128 } },
  { id: "webp", name: "WebP", text: "WebP at quality 85", preset: { kind: "image", format: "webp", quality: 85 } },
  { id: "jpg", name: "JPG", text: "JPG at quality 90, for HEIC photos too", preset: { kind: "image", format: "jpg", quality: 90 } },
  { id: "jpg-1600", name: "JPG 1600 px", text: "JPG with the long side at 1600 px", preset: { kind: "image", format: "jpg", maxSide: 1600, quality: 85 } },
  { id: "png", name: "PNG", text: "Lossless PNG", preset: { kind: "image", format: "png", quality: 100 } },
]

export function inKind(name: string): InKind | null {
  return VIDEO.test(name) ? "video" : AUDIO.test(name) ? "audio" : IMAGE.test(name) || HEIC.test(name) ? "image" : null
}

// Which inputs a preset takes: audio presets also take a video (the sound is extracted).
export const takes = (p: Preset, k: InKind | null) =>
  k !== null && (p.kind === "image" ? k === "image" : p.kind === "audio" ? k !== "image" : k === "video")

export const extOf = (p: Preset) => (p.kind === "video" ? p.container : p.kind === "gif" ? "gif" : p.format)

const MIME: Record<string, string> = {
  mp4: "video/mp4", mkv: "video/x-matroska", gif: "image/gif", mp3: "audio/mpeg", m4a: "audio/mp4", opus: "audio/ogg",
  flac: "audio/flac", wav: "audio/wav", jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
}
export const mimeOf = (p: Preset) => MIME[extOf(p)]

// "clip.mov" + "480p" -> "clip (480p).mp4"
export const outName = (input: string, label: string, p: Preset) =>
  `${input.replace(/\.[^.]+$/, "")} (${label.replace(/[\\/]/g, "-")}).${extOf(p)}`

// "1:30", "01:02:03" or "90" -> seconds; null for blank or junk.
export function parseTime(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const parts = t.split(":")
  if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null
  return parts.reduce((a, x) => a * 60 + Number(x), 0)
}

const int = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}
const secs = (v: unknown) => {
  const n = Number(v)
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 0 && n <= 86_400 ? n : undefined
}
const pick = <T extends string>(v: unknown, all: readonly T[]) => (all as readonly unknown[]).includes(v) ? (v as T) : undefined

// A preset from untrusted input (a server action's argument), clamped; null when it can't make sense.
export function cleanPreset(raw: unknown): Preset | null {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.kind === "video") {
    const codec = pick(r.codec, ["h264", "h265", "av1"] as const)
    const container = pick(r.container, ["mp4", "mkv"] as const)
    if (!codec || !container) return null
    const start = secs(r.start)
    const end = secs(r.end)
    if (start !== undefined && end !== undefined && end <= start) return null
    return { kind: "video", codec, container, height: int(r.height, 120, 4320), crf: int(r.crf, 10, 40), targetMb: int(r.targetMb, 1, 100_000), start, end }
  }
  if (r.kind === "gif") {
    const start = secs(r.start)
    const end = secs(r.end)
    if (start !== undefined && end !== undefined && end <= start) return null
    return { kind: "gif", width: int(r.width, 64, 1280) ?? 480, fps: int(r.fps, 1, 30) ?? 12, start, end }
  }
  if (r.kind === "audio") {
    const format = pick(r.format, ["mp3", "m4a", "opus", "flac", "wav"] as const)
    return format ? { kind: "audio", format, kbps: int(r.kbps, 32, 320) ?? 192 } : null
  }
  if (r.kind === "image") {
    const format = pick(r.format, ["jpg", "png", "webp", "avif"] as const)
    return format ? { kind: "image", format, maxSide: int(r.maxSide, 16, 16384), quality: int(r.quality, 1, 100) ?? 85 } : null
  }
  return null
}

const VCODEC = {
  off: { h264: "libx264", h265: "libx265", av1: "libsvtav1" },
  vaapi: { h264: "h264_vaapi", h265: "hevc_vaapi", av1: "av1_vaapi" },
  nvenc: { h264: "h264_nvenc", h265: "hevc_nvenc", av1: "av1_nvenc" },
} as const

// How long the output runs, for % and the target-size bitrate.
export const outSeconds = (p: Preset, duration: number) => {
  if (p.kind !== "video" && p.kind !== "gif") return duration
  const start = p.start ?? 0
  const end = Math.min(p.end ?? duration, p.kind === "gif" ? start + GIF_MAX_SECONDS : duration)
  return Math.max(0.1, Math.min(end, duration) - start)
}

// The ffmpeg arguments (after `ffmpeg`) for an audio, video or GIF preset. Images go through sharp.
// ponytail: target size is one pass at an average bitrate, so the file lands near it, not on it; two passes if that matters.
export function ffmpegArgs(p: Exclude<Preset, { kind: "image" }>, o: { input: string; out: string; duration: number | null; hw?: Hw }): string[] {
  const hw = p.kind === "video" ? (o.hw ?? "off") : "off"
  const a = ["-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-y"]
  if (hw === "vaapi") a.push("-vaapi_device", "/dev/dri/renderD128")
  const start = "start" in p ? p.start : undefined
  if (start) a.push("-ss", String(start))
  a.push("-i", o.input)
  if (p.kind === "video" || p.kind === "gif") {
    let t = o.duration === null ? (p.end === undefined ? undefined : p.end - (start ?? 0)) : outSeconds(p, o.duration)
    if (p.kind === "gif") t = Math.min(t ?? GIF_MAX_SECONDS, GIF_MAX_SECONDS)
    if (t !== undefined && (p.kind === "gif" || p.end !== undefined)) a.push("-t", String(t))
  }
  if (p.kind === "gif") {
    a.push("-vf", `fps=${p.fps},scale=${p.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, "-an", "-loop", "0", o.out)
    return a
  }
  if (p.kind === "audio") {
    a.push("-vn", "-map", "0:a:0", "-sn", "-dn")
    if (p.format === "mp3") a.push("-c:a", "libmp3lame", "-b:a", `${p.kbps}k`)
    else if (p.format === "m4a") a.push("-c:a", "aac", "-b:a", `${p.kbps}k`, "-movflags", "+faststart")
    else if (p.format === "opus") a.push("-c:a", "libopus", "-b:a", `${p.kbps}k`)
    else if (p.format === "flac") a.push("-c:a", "flac")
    else a.push("-c:a", "pcm_s16le")
    a.push(o.out)
    return a
  }
  const vf: string[] = []
  if (p.height) vf.push(`scale=-2:min(${p.height}\\,ih)`)
  if (hw === "vaapi") vf.push("format=nv12", "hwupload")
  a.push("-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn")
  if (vf.length) a.push("-vf", vf.join(","))
  a.push("-c:v", VCODEC[hw][p.codec])
  const kbps = p.targetMb && o.duration ? Math.max(100, Math.floor((p.targetMb * 8192) / outSeconds(p, o.duration) - 128)) : null
  if (kbps) a.push("-b:v", `${kbps}k`)
  const q = String(p.crf ?? (p.codec === "av1" ? 32 : p.codec === "h265" ? 28 : 23))
  if (hw === "off") {
    if (!kbps) a.push("-crf", q)
    a.push(...(p.codec === "av1" ? ["-preset", "8"] : ["-preset", "veryfast"]), "-pix_fmt", "yuv420p")
    if (p.codec === "h265" && p.container === "mp4") a.push("-tag:v", "hvc1")
  } else if (!kbps) a.push(hw === "vaapi" ? "-qp" : "-cq", q)
  a.push("-c:a", "aac", "-b:a", "128k", "-ac", "2")
  if (p.container === "mp4") a.push("-movflags", "+faststart")
  a.push(o.out)
  return a
}

// ffmpeg's -progress block (key=value lines) -> percent and seconds left. `total`: seconds of output.
export function progressOf(block: Record<string, string>, total: number): { pct: number; eta: number | null } | null {
  const us = Number(block.out_time_us ?? block.out_time_ms)
  if (!Number.isFinite(us) || us < 0) return null
  const done = us / 1e6
  const speed = parseFloat(block.speed ?? "")
  return { pct: Math.min(99, Math.floor((done / total) * 100)), eta: speed > 0 ? Math.max(0, Math.round((total - done) / speed)) : null }
}

export const STATUS = ["queued", "running", "done", "failed", "cancelled"] as const
export type JobStatus = (typeof STATUS)[number]
