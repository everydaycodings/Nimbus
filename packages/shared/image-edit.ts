// Maths for the photo editors (web canvas, app): the largest rectangle that fits inside a straightened photo, and the crop box.
export type Rect = { x: number; y: number; w: number; h: number }
export type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se"

export const MAX_ANGLE = 45

// The largest axis-aligned rectangle inside a w x h picture rotated by `deg`: what's left after Straighten, without the empty corners.
export function innerSize(w: number, h: number, deg: number) {
  const a = (Math.min(Math.abs(deg), 90) * Math.PI) / 180
  if (a < 1e-6) return { w, h }
  const sin = Math.sin(a)
  const cos = Math.cos(a)
  const long = Math.max(w, h)
  const short = Math.min(w, h)
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-9) {
    const x = short / 2
    return w >= h ? { w: x / sin, h: x / cos } : { w: x / cos, h: x / sin }
  }
  const c2 = cos * cos - sin * sin
  return { w: (w * cos - h * sin) / c2, h: (h * cos - w * sin) / c2 }
}

// The biggest centred box with pixel aspect `aspect` (width / height) inside a picture of `ratio` (its width / height).
export function fitAspect(aspect: number, ratio: number): Rect {
  const h = Math.min(1, ratio / aspect)
  const w = (h * aspect) / ratio
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
export const MIN_BOX = 0.08

// A crop box (0..1 of the picture) dragged by (dx, dy), also 0..1. `ratio` is the picture's width / height, and `aspect` the
// locked pixel aspect, or null for free. A locked box resizes from its corners only; its edges just move it.
export function dragCrop(r: Rect, handle: Handle, dx: number, dy: number, ratio: number, aspect: number | null): Rect {
  if (handle === "move" || (aspect && handle.length === 1))
    return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }
  const west = handle.includes("w")
  const east = handle.includes("e")
  const north = handle.includes("n")
  const south = handle.includes("s")
  if (aspect) {
    // Anchored at the opposite corner; the width leads and the height follows.
    const roomW = west ? r.x + r.w : 1 - r.x
    const roomH = north ? r.y + r.h : 1 - r.y
    const w = clamp(r.w + (west ? -dx : dx), MIN_BOX, Math.min(roomW, (roomH * aspect) / ratio))
    const h = (w * ratio) / aspect
    return { x: west ? r.x + r.w - w : r.x, y: north ? r.y + r.h - h : r.y, w, h }
  }
  let l = r.x
  let t = r.y
  let rt = r.x + r.w
  let b = r.y + r.h
  if (west) l = clamp(l + dx, 0, rt - MIN_BOX)
  if (east) rt = clamp(rt + dx, l + MIN_BOX, 1)
  if (north) t = clamp(t + dy, 0, b - MIN_BOX)
  if (south) b = clamp(b + dy, t + MIN_BOX, 1)
  return { x: l, y: t, w: rt - l, h: b - t }
}
