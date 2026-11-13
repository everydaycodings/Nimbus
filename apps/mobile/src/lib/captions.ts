// WebVTT for the player's caption overlay: expo-video can't load a subtitle file from a URL,
// so the app fetches the text, parses the cues and shows the one under the playhead.
export type Cue = { start: number; end: number; text: string }

const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

// Seconds in "00:01:02.500", "01:02.5" or "1:02,500".
const seconds = (s: string) => {
  const m = STAMP.exec(s)
  if (!m) return NaN
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000
}

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

// Cues in time order. Notes, styles and blocks without a time line are skipped.
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n")
    const at = lines.findIndex((l) => l.includes("-->"))
    if (at < 0) continue
    const [a, b] = lines[at].split("-->")
    const start = seconds(a)
    const end = seconds(b.trim().split(/\s+/)[0])
    const body = strip(lines.slice(at + 1).join("\n")).trim()
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body })
  }
  return cues.sort((x, y) => x.start - y.start)
}

// The cue showing at `t`, or null. Binary search, since this runs on every time update.
export function cueAt(cues: Cue[], t: number): Cue | null {
  let lo = 0
  let hi = cues.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  // Cues can overlap a little; look back a few for one still showing.
  for (let i = found; i >= 0 && i > found - 4; i--) if (t < cues[i].end) return cues[i]
  return null
}
