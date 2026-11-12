// Rules for playback (quality per network, sleep fade, cast URL refresh, resume), apart from the
// players so node --test can run them. No React or native imports.

// A video's size: the original or a data-saver copy's height.
export type Quality = "original" | 720 | 480

export const qualityLabel = (q: Quality) => (q === "original" ? "Original" : `${q}p`)

// What a video plays at: the original on Wi-Fi, and on mobile data the person's default, or the nearest
// smaller copy that is ready (a bigger one still beats the original), else the original.
export function pickQuality(onMobileData: boolean, want: Quality, ready: number[]): Quality {
  if (!onMobileData || want === "original") return "original"
  const sizes = ready.filter((h): h is 720 | 480 => h === 720 || h === 480)
  const under = sizes.filter((h) => h <= want)
  if (under.length) return Math.max(...under) as 720 | 480
  return sizes.length ? (Math.min(...sizes) as 720 | 480) : "original"
}

// The copy offline saves: the smallest ready one for Data-saver, else (or when none is ready) the original.
export function offlineQuality(setting: "original" | "data-saver", ready: number[]): Quality {
  return setting === "data-saver" ? pickQuality(true, 480, ready) : "original"
}

// ---- Sleep timer ----

export const SLEEP_MINUTES = [15, 30, 45, 60]
export const FADE_MS = 10_000
const MAX_MINUTES = 12 * 60

// A whole number of minutes from the custom field, or null.
export function customMinutes(text: string) {
  if (!/^\s*\d{1,4}\s*$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= MAX_MINUTES ? n : null
}

// Volume (0..1) for the time left: full until the last 10 s, then straight down to silence.
export function fadeGain(msLeft: number) {
  return Math.max(0, Math.min(1, msLeft / FADE_MS))
}

// How long to wait before the fade begins.
export const fadeStartsIn = (deadline: number, now: number) => Math.max(0, deadline - now - FADE_MS)

// ---- Cast ----

const MIN_REFRESH_MS = 30_000
const MARGIN_MS = 10 * 60_000

// When to fetch a new cast URL: ten minutes before the old one lapses, or halfway if it lapses sooner.
export function castRefreshIn(expiresAt: number, now: number) {
  const left = expiresAt - now
  return Math.max(MIN_REFRESH_MS, left - Math.min(MARGIN_MS, left / 2))
}

// ---- Resume ----

const RESUME_OVER_S = 600

// "Resume from 42:10 / Start over" is for media over 10 minutes, left somewhere in the middle.
export function offerResume(position: number | null | undefined, duration: number) {
  return !!position && duration > RESUME_OVER_S && position > 5 && position < duration - 10
}

// The server keeps a position only for media over 10 minutes, so shorter ones aren't sent.
export const keepsPosition = (duration: number) => duration > RESUME_OVER_S
