// Rules for the audio queue, apart from the player so they can be tested.

// Where to pick a track up again: the start when you barely began or were nearly done.
export function resumeAt(position: number, duration: number) {
  if (!(position > 5)) return 0
  if (duration > 0 && position > duration - 10) return 0
  return position
}

const BEFORE = 5
const AFTER = 25

// The slice of a folder's n tracks that goes into the queue around `index`:
// each track needs its own download link, so a huge folder isn't queued whole.
export function queueWindow(n: number, index: number) {
  const start = Math.max(0, index - BEFORE)
  return { start, end: Math.min(n, Math.max(index + AFTER, start + BEFORE + AFTER)) }
}
