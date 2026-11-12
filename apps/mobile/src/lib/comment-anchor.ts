// Ties comment anchors to the previewer: the page showing a video, audio or PDF registers here while
// it's on screen, so a new comment can take the current time and a chip can jump back.
export type AnchorTarget = {
  id: string
  time?: () => number
  seek?: (seconds: number) => void
  page?: (n: number) => void
}

let target: AnchorTarget | null = null

/** Call from an effect while the page is active; returns the cleanup. */
export function registerAnchor(t: AnchorTarget) {
  target = t
  return () => {
    if (target === t) target = null
  }
}

export const anchorTarget = (id: string) => (target?.id === id ? target : null)
