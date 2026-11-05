// Thumbnails are drawn in the browser: from the File right after an upload, or
// from S3 the first time someone who can edit the file sees its tile. Each is a
// WebP at most 480px on its long side, saved to /api/files/[id]/thumb.
import type { BundledLanguage } from "shiki"

import { previewUrl } from "@/app/(app)/upload-actions"
import { coverArt } from "@/lib/cover-art"
import { previewKind, thumbable, type PreviewKind } from "@/lib/file-rules"

const SIZE = 480
const TIMEOUT = 20_000

export const SHIKI_THEME = "github-dark-default"

// A local file, or a presigned URL.
type Src = Blob | string

export type ThumbFile = {
  id: string
  version: string | null
  mime: string | null
  name: string
  size: number
}

const ALIAS: Record<string, string> = {
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  mjs: "js",
  cjs: "js",
  htm: "html",
  conf: "ini",
  cfg: "ini",
  env: "dotenv",
  markdown: "md",
}

// Shiki's language for a file name; "text" when it has none.
export async function langOf(name: string): Promise<BundledLanguage | "text"> {
  const { bundledLanguages } = await import("shiki")
  const base = name.toLowerCase().split("/").pop()!
  const ext = base.includes(".") ? base.split(".").pop()! : base
  const lang = ALIAS[ext] ?? ext
  return lang in bundledLanguages ? (lang as BundledLanguage) : "text"
}

export async function readRange(src: Src, start: number, end: number) {
  if (typeof src !== "string")
    return new Uint8Array(await src.slice(start, end).arrayBuffer())
  const r = await fetch(src, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  })
  if (!r.ok) throw new Error(`Couldn't read the file (${r.status}).`)
  return new Uint8Array(await r.arrayBuffer())
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const webp = (c: HTMLCanvasElement) =>
  new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", 0.8))

function fit(src: CanvasImageSource, w: number, h: number) {
  if (!w || !h) return null
  const s = Math.min(1, SIZE / Math.max(w, h))
  const c = canvas(w * s, h * s)
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height)
  return webp(c)
}

// Blob URLs are made here and revoked when `fn` is done.
async function withUrl<T>(src: Src, fn: (url: string) => Promise<T>) {
  const url = typeof src === "string" ? src : URL.createObjectURL(src)
  try {
    return await fn(url)
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url)
  }
}

const image = (src: Src) =>
  withUrl(src, async (url) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = url
    // Formats the browser can't decode (HEIC, TIFF, …) get no thumbnail.
    if (
      !(await img.decode().then(
        () => true,
        () => false
      ))
    )
      return null
    // SVGs without a size draw at the tile's shape.
    return fit(img, img.naturalWidth || SIZE, img.naturalHeight || SIZE * 0.75)
  })

const video = (src: Src) =>
  withUrl(src, async (url) => {
    const v = document.createElement("video")
    v.muted = true
    v.playsInline = true
    v.preload = "auto"
    v.crossOrigin = "anonymous"
    try {
      const ok = await new Promise<boolean>((done, fail) => {
        v.onloadedmetadata = () => {
          v.currentTime = Math.min(1, (v.duration || 0) / 2)
        }
        v.onseeked = () => done(true)
        // A network error is worth retrying later; a codec the browser lacks isn't.
        v.onerror = () =>
          v.error?.code === MediaError.MEDIA_ERR_NETWORK
            ? fail(new Error("Couldn't load the video."))
            : done(false)
        v.src = url
      })
      return ok ? fit(v, v.videoWidth, v.videoHeight) : null
    } finally {
      v.removeAttribute("src")
      v.load()
    }
  })

async function audio(src: Src, size: number) {
  const pic = await coverArt((s, e) => readRange(src, s, e), size)
  return pic
    ? image(new Blob([pic.data as BlobPart], { type: pic.type }))
    : null
}

async function loadPdf(url: string) {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString()
  // Ranged reads: page 1 of a huge PDF doesn't download the rest.
  return pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true })
}

const pdf = (src: Src) =>
  withUrl(src, async (url) => {
    const task = await loadPdf(url)
    try {
      const doc = await task.promise.catch((e: Error) => {
        if (e.name === "InvalidPDFException") return null
        throw e
      })
      if (!doc) return null
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({
        scale: SIZE / Math.max(base.width, base.height),
      })
      const c = canvas(viewport.width, viewport.height)
      await page.render({ canvas: c, viewport }).promise
      return webp(c)
    } finally {
      task.destroy()
    }
  })

// The first lines, colored like the previewer shows them.
async function text(src: Src, name: string) {
  const head = await readRange(src, 0, 4096)
  if (head.includes(0)) return null
  const code = new TextDecoder()
    .decode(head)
    .split(/\r?\n/)
    .slice(0, 22)
    .map((l) => l.replace(/\t/g, "  ").slice(0, 100))
    .join("\n")
  const { codeToTokens } = await import("shiki")
  const { tokens, bg, fg } = await codeToTokens(code, {
    lang: await langOf(name),
    theme: SHIKI_THEME,
  })
  const family =
    getComputedStyle(document.body).getPropertyValue("--font-mono").trim() ||
    "monospace"
  const font = `15px ${family}`
  await document.fonts.load(font).catch(() => {})
  const c = canvas(SIZE, SIZE * 0.75)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = bg ?? "#0d1117"
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.font = font
  ctx.textBaseline = "top"
  tokens.forEach((line, i) => {
    let x = 20
    for (const t of line) {
      ctx.fillStyle = t.color ?? fg ?? "#e6edf3"
      ctx.fillText(t.content, x, 20 + i * 20)
      x += ctx.measureText(t.content).width
    }
  })
  return webp(c)
}

// Slide 1: its first picture, else its title on a dark card.
async function pptx(src: Src, size: number) {
  const { readPptx } = await import("@/lib/pptx")
  const [first] = await readPptx(
    typeof src === "string" ? await readRange(src, 0, size) : src
  )
  if (!first) return null
  if (first.images.length) return image(await first.images[0].blob())
  const family =
    getComputedStyle(document.body).getPropertyValue("--font-sans").trim() ||
    "sans-serif"
  const font = `600 30px ${family}`
  await document.fonts.load(font).catch(() => {})
  const c = canvas(SIZE, SIZE * 0.75)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#171717"
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.font = font
  ctx.fillStyle = "#fafafa"
  ctx.textBaseline = "top"
  // Word-wrapped, at most 6 lines.
  const lines: string[] = []
  for (const word of (first.title || first.paragraphs[0] || "").split(/\s+/)) {
    const last = lines.length - 1
    if (
      last >= 0 &&
      ctx.measureText(`${lines[last]} ${word}`).width < SIZE - 64
    )
      lines[last] += ` ${word}`
    else lines.push(word)
  }
  lines.slice(0, 6).forEach((l, i) => ctx.fillText(l, 32, 32 + i * 40))
  return webp(c)
}

// Null when the file has nothing to show (no cover art, a codec or format the
// browser can't read). Throws when it couldn't be read at all.
export async function makeThumb(
  src: Src,
  kind: PreviewKind,
  name: string,
  size: number
): Promise<Blob | null> {
  const work = (() => {
    switch (kind) {
      case "image":
        return image(src)
      case "video":
        return video(src)
      case "audio":
        return audio(src, size)
      case "pdf":
        return pdf(src)
      case "pptx":
        return pptx(src, size)
      default:
        return text(src, name)
    }
  })()
  let timer = 0
  const late = new Promise<never>((_, fail) => {
    timer = window.setTimeout(() => fail(new Error("Timed out.")), TIMEOUT)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

// Two at a time, so a folder full of videos doesn't stall the page.
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>) {
  if (running < 2) running++
  else await new Promise<void>((go) => waiting.push(go))
  try {
    return await fn()
  } finally {
    // Hand the slot straight to the next job, or free it.
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

const thumbUrl = (f: ThumbFile) => `/api/files/${f.id}/thumb?v=${f.version}`

// Saves a thumbnail, or "none" for null. Resolves its revision, or null.
async function save(f: ThumbFile, blob: Blob | null) {
  const r = await fetch(thumbUrl(f), {
    method: "POST",
    body: blob ?? new Blob(),
  })
  if (!r.ok) throw new Error("Couldn't save the thumbnail.")
  const { thumb } = (await r.json()) as { thumb: string }
  return thumb || null
}

const jobs = new Map<string, Promise<string | null>>()

// Makes and saves a version's thumbnail once per page load. `file` is the
// local copy right after an upload, which saves downloading it again.
// Resolves the new thumbnail's revision, or null when there isn't one.
export function ensureThumb(f: ThumbFile, file?: Blob) {
  const kind = previewKind(f.mime, f.name)
  if (!f.version || !kind || !thumbable(kind)) return Promise.resolve(null)
  let job = jobs.get(f.version)
  if (!job) {
    job = slot(async () => {
      const src = file ?? (await previewUrl(f.id, f.version))
      if (!src) return null
      return save(f, await makeThumb(src, kind, f.name, f.size))
    }).catch(() => null)
    jobs.set(f.version, job)
  }
  return job
}

// The owner's own picture, cropped and scaled like any thumbnail.
export async function thumbFromImage(f: ThumbFile, picked: File) {
  const blob = await image(picked)
  if (!blob) throw new Error("That image can't be read. Try a JPEG or PNG.")
  return save(f, blob)
}

// The frame a video is paused on. Its element needs crossOrigin="anonymous".
export async function thumbFromFrame(f: ThumbFile, v: HTMLVideoElement) {
  const blob = await fit(v, v.videoWidth, v.videoHeight)
  if (!blob) throw new Error("There's no frame to use yet.")
  return save(f, blob)
}

// Back to automatic: drawn again the next time a tile shows it.
export async function resetThumb(f: ThumbFile) {
  const r = await fetch(thumbUrl(f), { method: "DELETE" })
  if (!r.ok) throw new Error("Couldn't reset the thumbnail.")
  if (f.version) jobs.delete(f.version)
}
