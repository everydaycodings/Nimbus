// The words inside a file, for search. No app imports: scripts/indexer.ts runs
// it in Node.
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"

export type Source = "text" | "pdf" | "docx" | "sheet" | "pptx" | "ocr"

// Kept per file. ponytail: longer texts are cut off; index pages separately if
// people search deep into long books.
export const MAX_BODY = 200_000
// Bigger files aren't read at all.
export const READ_MAX = 50 * 1024 * 1024
export const OCR_MAX = 20 * 1024 * 1024
const PDF_PAGES = 300

export type OcrMode = "off" | "images" | "images_pdfs" | "all"

// Whether the admin's OCR switch lets text be read from this preview kind with
// OCR. PDFs still give their text layer when it doesn't.
export function ocrAllows(mode: OcrMode, kind: string | null) {
  if (kind === "image") return mode !== "off"
  if (kind === "pdf") return mode === "images_pdfs" || mode === "all"
  return kind === "video" && mode === "all"
}

// How a preview kind (lib/file-rules.ts) is read, or null when it has no text.
export function sourceOf(kind: string | null): Source | null {
  switch (kind) {
    case "text":
    case "markdown":
    case "csv":
      return "text"
    case "pdf":
    case "docx":
    case "sheet":
    case "pptx":
      return kind
    case "image":
      return "ocr"
    default:
      return null
  }
}

export const tooBig = (source: Source, size: number) =>
  size > (source === "ocr" ? OCR_MAX : READ_MAX)

const browser = typeof window !== "undefined"

function text(bytes: Uint8Array) {
  // Binary files that happen to look like text.
  if (bytes.subarray(0, 4096).includes(0)) return ""
  return new TextDecoder().decode(bytes.subarray(0, MAX_BODY * 4))
}

// One string per page, and how many had no text layer. With `scan`, pages without a text layer are drawn to an
// image and read by that function (Node only; needs @napi-rs/canvas, which pdfjs pulls in).
async function pdf(bytes: Uint8Array, scan?: (png: Uint8Array) => Promise<string>) {
  // The modern build needs browser APIs Node lacks.
  const pdfjs = browser
    ? await import("pdfjs-dist")
    : await import("pdfjs-dist/legacy/build/pdf.mjs")
  if (browser)
    pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString()
  const task = pdfjs.getDocument({
    data: bytes,
    // Node reads these from disk; without them every non-embedded font warns.
    standardFontDataUrl: browser
      ? undefined
      : `${process.cwd()}/../../node_modules/pdfjs-dist/standard_fonts/`,
  })
  try {
    const doc = await task.promise
    const out: string[] = []
    let length = 0
    let blank = 0
    for (let i = 1; i <= Math.min(doc.numPages, PDF_PAGES); i++) {
      const page = await doc.getPage(i)
      const { items } = await page.getTextContent()
      let t = items.map((it) => ("str" in it ? it.str : "")).join(" ")
      if (t.trim().length < 3) blank++
      if (scan && !browser && t.trim().length < 3) {
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) })
        const { canvas, context } = (
          doc.canvasFactory as {
            create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D }
          }
        ).create(viewport.width, viewport.height)
        await page.render({ canvasContext: context, viewport, canvas: canvas as HTMLCanvasElement }).promise
        t = await scan(await (canvas as { encode(f: "png"): Promise<Uint8Array> }).encode("png"))
        page.cleanup()
      }
      out.push(t)
      length += t.length
      if (length > MAX_BODY) break
    }
    return { pages: out, blank }
  } finally {
    task.destroy()
  }
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}
const unxml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1] === "x" || e[1] === "X"
              ? parseInt(e.slice(2), 16)
              : parseInt(e.slice(1), 10)
          )
        : (ENTITY[e] ?? m)
    )

// The body, headers and footers, one line per paragraph.
async function docx(bytes: Uint8Array) {
  const { unzip } = await import("unzipit")
  const { entries } = await unzip(bytes)
  const parts = Object.keys(entries)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .sort()
  const xml = await Promise.all(parts.map((n) => entries[n].text()))
  return xml
    .map((x) =>
      unxml(x.replace(/<\/w:p>/g, "\n").replace(/<w:(tab|br)\b[^>]*\/>/g, " "))
    )
    .join("\n")
}

async function sheet(bytes: Uint8Array) {
  const XLSX = await import("xlsx")
  const book = XLSX.read(bytes, { sheetRows: 5000, dense: true })
  return book.SheetNames.map(
    (name) => `${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`
  ).join("\n")
}

// Every slide's title and text, in slide order.
async function pptx(bytes: Uint8Array) {
  const { readPptx } = await import("./pptx.ts")
  return (await readPptx(bytes))
    .map((s) => [s.title, ...s.paragraphs].join("\n"))
    .join("\n")
}

export type Part = {
  kind: "page" | "time" | "line"
  page?: number
  tMs?: number
  /** x, y, w, h as 0-1 fractions of the image. */
  box?: [number, number, number, number]
  body: string
}

// Language data is cached here so it survives restarts (a compose volume); the
// local fallback is gitignored.
export const tessDir = () =>
  process.env.OCR_DATA_DIR ||
  (existsSync("/data/tessdata") ? "/data/tessdata" : `${process.cwd()}/.cache/tessdata`)

// One Tesseract worker per language set, kept for the page's (or process's) life.
const ocrWorkers = new Map<string, Promise<import("tesseract.js").Worker>>()
async function ocrWorker(langs: string) {
  let w = ocrWorkers.get(langs)
  if (!w) {
    // Without an errorHandler, an unreadable image throws inside the worker
    // instead of rejecting recognize().
    w = import("tesseract.js").then(async (t) => {
      const dir = browser ? undefined : tessDir()
      if (dir) await mkdir(dir, { recursive: true })
      // Downloaded from tesseract.js's default source the first time, then read from the cache.
      return t.createWorker(
        langs.split("+"),
        undefined,
        dir
          ? { errorHandler: () => {}, cachePath: dir }
          : { errorHandler: () => {} }
      )
    })
    ocrWorkers.set(langs, w)
    w.catch(() => ocrWorkers.delete(langs))
  }
  return w
}

// Stops the OCR workers, for scripts and tests that should exit.
export async function closeOcr() {
  const all = [...ocrWorkers.values()]
  ocrWorkers.clear()
  await Promise.all(all.map((w) => w.then((x) => x.terminate()).catch(() => {})))
}

// Downloads one language's data into the cache. Throws when it can't.
export async function fetchLang(lang: string) {
  const dir = tessDir()
  await mkdir(dir, { recursive: true })
  const t = await import("tesseract.js")
  const w = await Promise.race([
    t.createWorker([lang], undefined, { errorHandler: () => {}, cachePath: dir }),
    new Promise<never>((_, no) =>
      setTimeout(() => no(new Error("The download took too long.")), 120_000)
    ),
  ])
  await w.terminate()
}

const mostlyLetters = (l: string) =>
  (l.match(/\p{L}/gu)?.length ?? 0) >= l.trim().length / 2

// Lines of text in an image, each with its box. Empty for photos without writing.
export async function ocrLines(bytes: Uint8Array, langs: string) {
  const worker = await ocrWorker(langs)
  let input: Buffer | Blob = browser
    ? new Blob([bytes as BlobPart])
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let w = 0
  let h = 0
  if (!browser) {
    // Turned upright first, so the boxes match what the previewer shows.
    const sharp = (await import("sharp")).default
    const r = await sharp(input as Buffer, { limitInputPixels: false })
      .rotate()
      .toBuffer({ resolveWithObject: true })
      .catch(() => null)
    if (r) [input, w, h] = [r.data, r.info.width, r.info.height]
  }
  const { data } = await worker.recognize(input, {}, { text: true, blocks: true })
  // Photos without writing come back as a few unsure "words".
  if (data.confidence < 55) return []
  const lines = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines)
  )
  // Without sharp's size (browser, unreadable by sharp): the extent of what was read.
  w ||= Math.max(1, ...lines.map((l) => l.bbox.x1))
  h ||= Math.max(1, ...lines.map((l) => l.bbox.y1))
  const f = (n: number, d: number) => Math.min(1, Math.max(0, +(n / d).toFixed(4)))
  return lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text && mostlyLetters(l.text))
    .map<Part>((l) => ({
      kind: "line",
      box: [
        f(l.bbox.x0, w),
        f(l.bbox.y0, h),
        f(l.bbox.x1 - l.bbox.x0, w),
        f(l.bbox.y1 - l.bbox.y0, h),
      ],
      body: l.text,
    }))
}

const ocr = async (bytes: Uint8Array, langs: string) =>
  (await ocrLines(bytes, langs)).map((l) => l.body).join("\n")

const tidy = (raw: string) =>
  raw
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()

// The file's text, whitespace collapsed and cut to MAX_BODY. "" when there's
// none. Throws when the file can't be read as that kind.
export async function extractText(
  bytes: Uint8Array,
  source: Source,
  langs = "eng"
) {
  return (await extractParts(bytes, source, langs, false)).body
}

// The text plus where it sits: a part per PDF page (scanned pages read by OCR
// when `ocrPdf`) and per image line. Other kinds have the body only. `ocr` is
// what node_content.ocr_langs gets: the languages when OCR ran, "-" when a
// scanned PDF page was left unread (OCR off for PDFs), else null.
export async function extractParts(
  bytes: Uint8Array,
  source: Source,
  langs = "eng",
  ocrPdf = true
): Promise<{ body: string; parts: Part[]; ocr: string | null }> {
  let parts: Part[] = []
  let raw: string
  let ocred: string | null = source === "ocr" ? langs : null
  if (source === "pdf") {
    const { pages, blank } = await pdf(
      bytes,
      ocrPdf ? (png) => ocr(png, langs) : undefined
    )
    if (blank) ocred = ocrPdf ? langs : "-"
    parts = pages
      .map((p, i) => ({ kind: "page" as const, page: i + 1, body: tidy(p) }))
      .filter((p) => p.body)
    raw = pages.join("\n")
  } else if (source === "ocr") {
    parts = await ocrLines(bytes, langs)
    raw = parts.map((p) => p.body).join("\n")
  } else
    raw =
      source === "text"
        ? text(bytes)
        : source === "docx"
          ? await docx(bytes)
          : source === "sheet"
            ? await sheet(bytes)
            : await pptx(bytes)
  const body = tidy(raw).slice(0, MAX_BODY)
  return { body, parts, ocr: ocred }
}
