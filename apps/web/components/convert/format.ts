// Words for presets and times. Plain module, shared by the page's client components.
import { QUALITY, type Preset } from "@/lib/convert/rules"

export function describe(p: Preset): string {
  if (p.kind === "video") {
    const q = p.targetMb ? `about ${p.targetMb} MB` : (QUALITY.find(([, v]) => v === p.crf)?.[0] ?? (p.crf ? `CRF ${p.crf}` : "Balanced"))
    const trim = p.start !== undefined || p.end !== undefined ? ` · trim ${clock(p.start ?? 0)}–${p.end === undefined ? "end" : clock(p.end)}` : ""
    return `${{ h264: "H.264", h265: "H.265", av1: "AV1" }[p.codec]} ${p.container.toUpperCase()} · ${p.height ? `${p.height}p` : "same size"} · ${q}${trim}`
  }
  if (p.kind === "gif") return `GIF · ${p.width} px wide · ${p.fps} fps${p.start !== undefined || p.end !== undefined ? ` · trim ${clock(p.start ?? 0)}–${p.end === undefined ? "end" : clock(p.end)}` : ""}`
  if (p.kind === "audio") return `${p.format.toUpperCase()}${p.format === "flac" || p.format === "wav" ? " · lossless" : ` · ${p.kbps} kbps`}`
  return `${p.format.toUpperCase()}${p.format === "png" ? "" : ` · quality ${p.quality}`}${p.maxSide ? ` · up to ${p.maxSide} px` : ""}`
}

export function clock(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`
}

// "about 2 min left"
export function left(sec: number | null) {
  if (sec === null) return ""
  return sec < 60 ? `about ${Math.max(1, sec)} s left` : sec < 3600 ? `about ${Math.round(sec / 60)} min left` : `about ${Math.round(sec / 360) / 10} h left`
}
