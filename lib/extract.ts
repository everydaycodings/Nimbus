// The words inside a file, for search. No app imports: the browser runs it
// after uploads and on tiles, and scripts/indexer.ts runs it in Node.

export type Source = "text" | "pdf" | "docx" | "sheet" | "ocr"

// Kept per file. ponytail: longer texts are cut off; index pages separately if
// people search deep into long books.
export const MAX_BODY = 200_000
// Bigger files aren't read at all.
export const READ_MAX = 50 * 1024 * 1024
export const OCR_MAX = 20 * 1024 * 1024
const PDF_PAGES = 300

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

async function pdf(bytes: Uint8Array) {
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
      : `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
  })
  try {
    const doc = await task.promise
    const out: string[] = []
    let length = 0
    for (let i = 1; i <= Math.min(doc.numPages, PDF_PAGES); i++) {
      const page = await doc.getPage(i)
      const { items } = await page.getTextContent()
      const t = items.map((it) => ("str" in it ? it.str : "")).join(" ")
      out.push(t)
      length += t.length
      if (length > MAX_BODY) break
    }
    return out.join("\n")
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

// One Tesseract worker per language set, kept for the page's (or process's) life.
const ocrWorkers = new Map<string, Promise<import("tesseract.js").Worker>>()
async function ocr(bytes: Uint8Array, langs: string) {
  let w = ocrWorkers.get(langs)
  if (!w) {
    // Without an errorHandler, an unreadable image throws inside the worker
    // instead of rejecting recognize().
    w = import("tesseract.js").then((t) =>
      t.createWorker(langs.split("+"), undefined, { errorHandler: () => {} })
    )
    ocrWorkers.set(langs, w)
    w.catch(() => ocrWorkers.delete(langs))
  }
  const worker = await w
  const input = browser
    ? new Blob([bytes as BlobPart])
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { data } = await worker.recognize(input)
  // Photos without writing come back as a few unsure "words".
  if (data.confidence < 55) return ""
  // Tesseract reads noise as text; drop lines that are mostly not letters.
  return data.text
    .split("\n")
    .filter((l) => (l.match(/\p{L}/gu)?.length ?? 0) >= l.trim().length / 2)
    .join("\n")
}

// The file's text, whitespace collapsed and cut to MAX_BODY. "" when there's
// none. Throws when the file can't be read as that kind.
export async function extractText(
  bytes: Uint8Array,
  source: Source,
  langs = "eng"
) {
  const raw =
    source === "text"
      ? text(bytes)
      : source === "pdf"
        ? await pdf(bytes)
        : source === "docx"
          ? await docx(bytes)
          : source === "sheet"
            ? await sheet(bytes)
            : await ocr(bytes, langs)
  return raw
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_BODY)
}
