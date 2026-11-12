// The signature pad: draw, type or a picture with its paper made transparent, exported as a cropped transparent PNG.
// Same canvas work as the web's SignatureDialog; the app's native sheet drives it through window.__cmd.
import { el, post } from "./core"

declare global {
  interface Window {
    __cmd(c: Record<string, unknown>): void
  }
}

const PAD_W = 1120
const PAD_H = 400
const MAX_W = 640

let mode = "draw"
let ink = "#111827"
let font = "Caveat"
let text = ""
let picked: HTMLCanvasElement | null = null
let drawn = false
let had = false

document.body.className = "sig"
document.documentElement.style.background = "#fff"
const pad = el("canvas", "sigpad")
pad.width = PAD_W
pad.height = PAD_H
// Drawn strokes live here so switching to Type and back doesn't lose them.
const ink_ = el("canvas")
ink_.width = PAD_W
ink_.height = PAD_H
document.body.append(pad)
const ctx = pad.getContext("2d")!
const ictx = ink_.getContext("2d")!

const has = () => (mode === "draw" ? drawn : mode === "type" ? text.trim().length > 0 : picked !== null)
function tell() {
  if (has() !== had) post({ t: "has", on: (had = has()) })
}

const typed = () => {
  const c = el("canvas")
  c.width = PAD_W
  c.height = PAD_H
  const x = c.getContext("2d")!
  let size = 220
  x.font = `${size}px "${font}"`
  while (x.measureText(text).width > PAD_W - 40 && size > 40) x.font = `${(size -= 10)}px "${font}"`
  x.fillStyle = ink
  x.textBaseline = "alphabetic"
  x.fillText(text, 20, PAD_H * 0.65)
  return c
}

function show() {
  ctx.clearRect(0, 0, PAD_W, PAD_H)
  if (mode === "draw") ctx.drawImage(ink_, 0, 0)
  else if (mode === "type") ctx.drawImage(typed(), 0, 0)
  else if (picked) {
    const k = Math.min(PAD_W / picked.width, PAD_H / picked.height, 1)
    const w = picked.width * k
    const h = picked.height * k
    ctx.drawImage(picked, (PAD_W - w) / 2, (PAD_H - h) / 2, w, h)
  }
  tell()
}

// The bounding box of non-transparent pixels, plus a margin; null when nothing is drawn.
function trimmed(c: HTMLCanvasElement) {
  const { width, height } = c
  const d = c.getContext("2d")!.getImageData(0, 0, width, height).data
  let [x1, y1, x2, y2] = [width, height, -1, -1]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (d[(y * width + x) * 4 + 3] > 8) {
        x1 = Math.min(x1, x)
        x2 = Math.max(x2, x)
        y1 = Math.min(y1, y)
        y2 = Math.max(y2, y)
      }
  if (x2 < 0) return null
  const m = 6
  const w = x2 - x1 + 1 + 2 * m
  const h = y2 - y1 + 1 + 2 * m
  const k = Math.min(1, MAX_W / w)
  const out = el("canvas")
  out.width = Math.max(1, Math.round(w * k))
  out.height = Math.max(1, Math.round(h * k))
  const o = out.getContext("2d")!
  o.imageSmoothingQuality = "high"
  o.drawImage(c, x1 - m, y1 - m, w, h, 0, 0, out.width, out.height)
  return out
}

// A photographed signature on white paper: near-white pixels fade to transparent.
function withoutPaper(img: ImageBitmap) {
  const k = Math.min(1, 1200 / Math.max(img.width, img.height))
  const c = el("canvas")
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const x = c.getContext("2d")!
  x.drawImage(img, 0, 0, c.width, c.height)
  const data = x.getImageData(0, 0, c.width, c.height)
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    if (lum >= 240) d[i + 3] = 0
    else if (lum > 200) d[i + 3] = Math.round((d[i + 3] * (240 - lum)) / 40)
  }
  x.putImageData(data, 0, 0)
  return c
}

// ---- Drawing ----

let pen: { x: number; y: number } | null = null
const pos = (e: PointerEvent) => {
  const r = pad.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H }
}
function stroke(a: { x: number; y: number }, b: { x: number; y: number }) {
  ictx.strokeStyle = ink
  ictx.lineWidth = 7
  ictx.lineCap = ictx.lineJoin = "round"
  ictx.beginPath()
  ictx.moveTo(a.x, a.y)
  ictx.lineTo(b.x, b.y)
  ictx.stroke()
  show()
}
pad.addEventListener("pointerdown", (e) => {
  if (mode !== "draw") return
  pad.setPointerCapture(e.pointerId)
  pen = pos(e)
  drawn = true
  stroke(pen, pen)
})
pad.addEventListener("pointermove", (e) => {
  if (!pen) return
  const p = pos(e)
  stroke(pen, p)
  pen = p
})
pad.addEventListener("pointerup", () => (pen = null))
pad.addEventListener("pointercancel", () => (pen = null))

// ---- Commands from the app ----

async function png(id: number) {
  try {
    await document.fonts.load(`40px "${font}"`)
    const src = mode === "draw" ? ink_ : mode === "type" ? typed() : picked!
    const c = trimmed(src)
    if (!c) return post({ t: "png", id, b64: null })
    const url = c.toDataURL("image/png")
    post({ t: "png", id, b64: url.slice(url.indexOf(",") + 1) })
  } catch {
    post({ t: "png", id, b64: null })
  }
}

window.__cmd = (c) => {
  switch (c.c) {
    case "mode":
      mode = String(c.v)
      return show()
    case "ink":
      ink = String(c.v)
      // Strokes already drawn take the new ink.
      ictx.globalCompositeOperation = "source-in"
      ictx.fillStyle = ink
      ictx.fillRect(0, 0, PAD_W, PAD_H)
      ictx.globalCompositeOperation = "source-over"
      return show()
    case "font":
      font = String(c.v)
      return void document.fonts.load(`40px "${font}"`).then(show)
    case "text":
      text = String(c.v)
      return show()
    case "clear":
      ictx.clearRect(0, 0, PAD_W, PAD_H)
      drawn = false
      picked = null
      return show()
    case "image": {
      const bytes = Uint8Array.from(atob(String(c.b64)), (ch) => ch.charCodeAt(0))
      return void createImageBitmap(new Blob([bytes])).then(
        (img) => {
          picked = withoutPaper(img)
          show()
        },
        () => post({ t: "imageError" })
      )
    }
    case "export":
      return void png(Number(c.id))
  }
}

for (const f of ["Caveat", "Dancing Script", "Great Vibes"]) void document.fonts.load(`40px "${f}"`)
post({ t: "ready" })
