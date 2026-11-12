// The photo editor's rules: what can be edited, the saved format, and where the crop lands on a straightened picture.
// No React or native imports, so node --test can run it.
import { innerSize, type Rect } from "@nimbus/shared/image-edit"

export const EDIT_LONG_SIDE = 4096

// JPEG, PNG and WebP: what the manipulator writes back and the server's thumbnails read.
export const canEditPhoto = (mime: string | null) => /^image\/(jpeg|png|webp)$/.test(mime ?? "")
export const outFormat = (mime: string | null) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpeg")

export type Geo = { quarter: number; flip: boolean; angle: number; crop: Rect; aspect: number | null }
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
export const START: Geo = { quarter: 0, flip: false, angle: 0, crop: FULL, aspect: null }
export const same = (a: Geo, b: Geo) => JSON.stringify(a) === JSON.stringify(b)

// W x H is the picture after the quarter turns and flip; (ew, eh) its size once rotated by the angle (empty corners included).
// Returns the manipulator's crop: the largest box inside the tilted picture, then the user's box inside that.
export function cropBox(W: number, H: number, ew: number, eh: number, g: Geo) {
  const inner = innerSize(W, H, g.angle)
  const x = (ew - inner.w) / 2 + g.crop.x * inner.w
  const y = (eh - inner.h) / 2 + g.crop.y * inner.h
  const originX = Math.min(Math.max(0, Math.round(x)), ew - 1)
  const originY = Math.min(Math.max(0, Math.round(y)), eh - 1)
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.round(g.crop.w * inner.w), ew - originX)),
    height: Math.max(1, Math.min(Math.round(g.crop.h * inner.h), eh - originY)),
  }
}

// The size markup is flattened at: the crop's own size, brought down to the long-side limit.
export function flatSize(w: number, h: number) {
  const k = Math.min(1, EDIT_LONG_SIDE / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}
