// Rules for the audio queue, apart from the player so they can be tested.

const BEFORE = 5
const AFTER = 25

// The slice of a folder's n tracks that goes into the queue around `index`:
// each track needs its own download link, so a huge folder isn't queued whole.
export function queueWindow(n: number, index: number) {
  const start = Math.max(0, index - BEFORE)
  return { start, end: Math.min(n, Math.max(index + AFTER, start + BEFORE + AFTER)) }
}
