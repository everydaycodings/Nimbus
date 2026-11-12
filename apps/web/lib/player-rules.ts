// Pure player rules shared by the video player, the audio player and their tests: the
// sleep timer's clock and fade, which quality to play, the audio queue's order.
// No `@/` imports, so player-rules.test.ts runs under plain node.

export const SLEEP_PRESETS = [15, 30, 45, 60]
export const FADE_MS = 10_000
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// "at": a wall-clock moment. "end": when the current video or track finishes.
export type Sleep = { kind: "at"; at: number } | { kind: "end" }

// Custom minutes from a text box: whole minutes from 1 to 24 h, else null.
export function sleepMinutes(raw: string) {
  const n = Math.round(Number(raw))
  return raw.trim() && n >= 1 && n <= 1440 ? n : null
}

// Milliseconds until playback must stop. For "end", the media's remaining time at its speed.
export function sleepLeftMs(
  s: Sleep,
  now: number,
  mediaLeftSec: number,
  rate: number
) {
  if (s.kind === "at") return s.at - now
  return Number.isFinite(mediaLeftSec) ? (mediaLeftSec / (rate || 1)) * 1000 : Infinity
}

// Volume factor during the last 10 s: 1 outside the fade, down to 0 at the stop.
export const fadeGain = (leftMs: number) =>
  Math.min(Math.max(leftMs / FADE_MS, 0), 1)

// "12 min", "45 s", for the sleep button.
export const sleepText = (leftMs: number) => {
  const s = Math.max(Math.ceil(leftMs / 1000), 0)
  return s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`
}

// The quality to start with: the data-saver size when the browser asks for it and
// it's ready, otherwise the original (null).
export const defaultQuality = (saveData: boolean, ready: number[]) =>
  saveData && ready.includes(480) ? 480 : null

// A wanted size that isn't ready falls back to the original.
export const usableQuality = (wanted: number | null, ready: number[]) =>
  wanted && ready.includes(wanted) ? wanted : null

export const parseSpeed = (raw: string | null) => {
  const n = Number(raw)
  return n >= 0.25 && n <= 4 ? n : 1
}

// "1:02:03" or "4:05".
export function clock(s: number) {
  if (!Number.isFinite(s)) return "0:00"
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

// ---- Audio queue ----
export type Repeat = "off" | "all" | "one"

// The play order and where in it `first` is: the list as is, or shuffled with `first` in front.
export function playOrder(n: number, first: number, shuffle: boolean, rand = Math.random) {
  const order = Array.from({ length: n }, (_, i) => i)
  if (!shuffle) return { order, pos: first }
  const rest = order.filter((i) => i !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return { order: [first, ...rest], pos: 0 }
}

// The next position in the order, or null to stop. A finished track (auto) repeats
// on "one"; the next/previous buttons wrap only on "all".
export function stepPos(len: number, pos: number, dir: 1 | -1, repeat: Repeat, auto: boolean) {
  if (auto && repeat === "one") return pos
  const to = pos + dir
  if (to >= 0 && to < len) return to
  return repeat === "all" ? (to + len) % len : null
}
