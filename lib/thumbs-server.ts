// Thumbnails drawn in the worker for files no browser handled (WebDAV, the
// API), matching lib/thumbs.ts: a WebP at most 480px on its long side. Videos,
// audio and the rest stay with the browser.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import sharp from "sharp"

import type { PreviewKind } from "./file-rules.ts"

const SIZE = 480
const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`
// The Docker image has no system fonts; pdfjs ships a Courier look-alike.
GlobalFonts.registerFromPath(`${FONTS}FoxitFixed.pfb`, "Thumb Mono")

export const serverThumbable = (k: PreviewKind | null) =>
  k === "image" ||
  k === "pdf" ||
  k === "text" ||
  k === "markdown" ||
  k === "csv"

const image = (bytes: Uint8Array) =>
  sharp(bytes, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

async function pdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({
    // A copy: pdfjs takes over its buffer, and Buffers are refused.
    data: new Uint8Array(bytes),
    standardFontDataUrl: FONTS,
  })
  try {
    const page = await (await task.promise).getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({
      scale: SIZE / Math.max(base.width, base.height),
    })
    const c = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    )
    const ctx = c.getContext("2d")
    // PDFs assume white paper.
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, c.width, c.height)
    await page.render({
      canvas: c as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
    return c.encode("webp", 80)
  } finally {
    task.destroy()
  }
}

// The first lines in plain monospace on the app's card color (--card).
function text(bytes: Uint8Array) {
  const head = bytes.subarray(0, 4096)
  if (head.includes(0)) return null
  const lines = new TextDecoder()
    .decode(head)
    .split(/\r?\n/)
    .slice(0, 22)
    .map((l) => l.replace(/\t/g, "  ").slice(0, 100))
  const c = createCanvas(SIZE, SIZE * 0.75)
  const ctx = c.getContext("2d")
  ctx.fillStyle = "#171717"
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.font = "15px 'Thumb Mono'"
  ctx.textBaseline = "top"
  ctx.fillStyle = "#e5e5e5"
  lines.forEach((l, i) => ctx.fillText(l, 20, 20 + i * 20))
  return c.encode("webp", 80)
}

// A WebP, or null when the file has nothing to show or can't be read.
export async function serverThumb(
  bytes: Uint8Array,
  kind: PreviewKind
): Promise<Uint8Array | null> {
  try {
    if (kind === "image") return await image(bytes)
    if (kind === "pdf") return await pdf(bytes)
    return await text(bytes)
  } catch {
    return null
  }
}
