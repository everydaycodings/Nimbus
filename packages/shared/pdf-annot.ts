import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib"

// PDF markup as one small model of our own: every mark here is a real annotation in the file (editable in other
// readers, never flattened). readMarks lifts the supported subtypes out of a PDF, writeMarks puts a list of marks back
// (replacing those subtypes on every page, with /AP appearance streams so every reader draws them). Links, form
// fields and every other annotation are left alone. Coordinates are PDF user space (points, origin bottom-left).

export type Pt = [number, number]
/** x1, y1, x2, y2 with x1 <= x2 and y1 <= y2. */
export type Box = [number, number, number, number]

type Common = {
  /** Zero-based. */
  page: number
  /** #rrggbb */
  color: string
  /** 0..1, left out when the mark is opaque. */
  opacity?: number
  author?: string
  contents?: string
}

export type Mark = Common &
  (
    | { kind: "highlight" | "underline" | "strike"; quads: Box[] }
    // Sticky note: the icon sits in the 20-point square starting at `at` (lower-left).
    | { kind: "note"; at: Pt }
    // Free text: Helvetica, lines split on \n, no wrapping. `size` is the font size in points.
    | { kind: "text"; rect: Box; size: number }
    | { kind: "ink"; width: number; paths: Pt[][] }
    | { kind: "rect" | "ellipse"; rect: Box; width: number }
    | { kind: "line" | "arrow"; a: Pt; b: Pt; width: number }
    // A signature or other picture. The PNG also rides in the annotation (/NimbusPng) so it can be read back.
    | { kind: "stamp"; rect: Box; png: Uint8Array }
  )

export const NOTE_SIZE = 20
export const TEXT_PAD = 2
export const TEXT_LEADING = 1.2
// First baseline below the top of a free text box, as a share of the font size.
const ASCENT = 0.92

// The two wing tips of an open arrowhead at `b`, shared so the editor draws what the file will hold.
export function arrowWings(a: Pt, b: Pt, width: number): [Pt, Pt] {
  const turn = Math.atan2(b[1] - a[1], b[0] - a[0])
  const head = Math.min(Math.max(width * 5, 8), Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)
  const wing = (s: number): Pt => [
    b[0] - head * Math.cos(turn - s * 0.45),
    b[1] - head * Math.sin(turn - s * 0.45),
  ]
  return [wing(-1), wing(1)]
}

// ---- Small helpers ----

const SUPPORTED = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Text",
  "FreeText",
  "Ink",
  "Square",
  "Circle",
  "Line",
])
const MARKUP_LINE = 1

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const hex = (c: number[]) =>
  "#" +
  c
    .slice(0, 3)
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
const n3 = (n: number) => +n.toFixed(3)
const box = (pts: Pt[], pad = 0): Box => [
  Math.min(...pts.map((p) => p[0])) - pad,
  Math.min(...pts.map((p) => p[1])) - pad,
  Math.max(...pts.map((p) => p[0])) + pad,
  Math.max(...pts.map((p) => p[1])) + pad,
]
const union = (boxes: Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
]

// ponytail: Helvetica in WinAnsi only (Latin text); anything else shows as "?". Needs an embedded font for other scripts.
function winAnsi(line: string) {
  return (
    "<" +
    [...line]
      .map((ch) => {
        const c = ch.codePointAt(0)!
        return (c >= 32 && c < 127) || (c >= 160 && c < 256) ? c : 63
      })
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("") +
    ">"
  )
}

const text = (s: string) => PDFHexString.fromText(s)
const decode = (o: PDFObject | undefined) =>
  o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined
const nums = (o: PDFObject | undefined): number[] =>
  o instanceof PDFArray
    ? o.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0))
    : []

// ---- Writing ----

type Ctx = PDFDocument["context"]

function appearance(ctx: Ctx, bbox: Box, body: string, extra: object = {}, opacity?: number, multiply = false) {
  const gs = opacity !== undefined || multiply
  const stream = ctx.stream(gs ? `/GS gs\n${body}` : body, {
    Type: "XObject",
    Subtype: "Form",
    BBox: bbox,
    Resources: {
      ...(gs && {
        ExtGState: {
          GS: {
            Type: "ExtGState",
            ...(multiply && { BM: "Multiply" }),
            CA: opacity ?? 1,
            ca: opacity ?? 1,
          },
        },
      }),
      ...extra,
    },
  })
  return ctx.register(stream)
}

const stroke = (color: string, w: number) =>
  `${rgb(color).map(n3).join(" ")} RG ${n3(w)} w 1 J 1 j\n`

function ellipse([x1, y1, x2, y2]: Box) {
  const k = 0.5523
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const rx = (x2 - x1) / 2
  const ry = (y2 - y1) / 2
  const f = (...v: number[]) => v.map(n3).join(" ")
  return (
    `${f(cx + rx, cy)} m\n` +
    `${f(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)} c\n` +
    `${f(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)} c\n` +
    `${f(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)} c\n` +
    `${f(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)} c\nS\n`
  )
}

async function annotation(doc: PDFDocument, m: Mark, helv: () => PDFRef) {
  const { context: ctx } = doc
  const c = rgb(m.color)
  const color = c.map(n3).join(" ")
  const base: Record<string, unknown> = {
    Type: "Annot",
    F: 4,
    // Free text and stamps have no border colour of their own to set.
    ...(m.kind !== "text" && m.kind !== "stamp" && { C: c }),
    ...(m.opacity !== undefined && { CA: m.opacity }),
    ...(m.author !== undefined && { T: text(m.author) }),
    ...(m.contents !== undefined && { Contents: text(m.contents) }),
  }
  let own: Record<string, unknown>
  switch (m.kind) {
    case "highlight":
    case "underline":
    case "strike": {
      const rect = union(m.quads)
      const quad = ([x1, y1, x2, y2]: Box) => [x1, y2, x2, y2, x1, y1, x2, y1]
      const body =
        m.kind === "highlight"
          ? `${color} rg\n` +
            m.quads
              .map(([x1, y1, x2, y2]) => `${n3(x1)} ${n3(y1)} ${n3(x2 - x1)} ${n3(y2 - y1)} re f\n`)
              .join("")
          : stroke(m.color, MARKUP_LINE) +
            m.quads
              .map(([x1, y1, x2, y2]) => {
                const y = m.kind === "underline" ? y1 + MARKUP_LINE : (y1 + y2) / 2
                return `${n3(x1)} ${n3(y)} m ${n3(x2)} ${n3(y)} l S\n`
              })
              .join("")
      own = {
        Subtype: { highlight: "Highlight", underline: "Underline", strike: "StrikeOut" }[m.kind],
        Rect: rect,
        QuadPoints: m.quads.flatMap(quad),
        AP: { N: appearance(ctx, rect, body, {}, m.opacity, m.kind === "highlight") },
      }
      break
    }
    case "note": {
      const [x, y] = m.at
      const rect: Box = [x, y, x + NOTE_SIZE, y + NOTE_SIZE]
      const body =
        `${color} rg 0 0 0 RG 0.8 w\n${n3(x + 1)} ${n3(y + 1)} ${NOTE_SIZE - 2} ${NOTE_SIZE - 2} re B\n` +
        [6, 10, 14]
          .map((d) => `${n3(x + 5)} ${n3(y + d)} m ${n3(x + NOTE_SIZE - 5)} ${n3(y + d)} l S\n`)
          .join("")
      own = {
        Subtype: "Text",
        Name: "Comment",
        Open: false,
        Rect: rect,
        AP: { N: appearance(ctx, rect, body, {}, m.opacity) },
      }
      break
    }
    case "text": {
      const [x1, , , y2] = m.rect
      const lines = (m.contents ?? "").split("\n")
      const body =
        `BT /Helv ${n3(m.size)} Tf ${color} rg ${n3(m.size * TEXT_LEADING)} TL\n` +
        `${n3(x1 + TEXT_PAD)} ${n3(y2 - TEXT_PAD - m.size * ASCENT)} Td\n` +
        lines.map((l) => `${winAnsi(l)} Tj T*\n`).join("") +
        "ET\n"
      own = {
        Subtype: "FreeText",
        Rect: m.rect,
        DA: PDFString.of(`/Helv ${n3(m.size)} Tf ${color} rg`),
        Q: 0,
        AP: { N: appearance(ctx, m.rect, body, { Font: { Helv: helv() } }, m.opacity) },
      }
      break
    }
    case "ink": {
      const rect = box(m.paths.flat(), m.width)
      const body =
        stroke(m.color, m.width) +
        m.paths
          .map(
            (p) =>
              p.map(([x, y], i) => `${n3(x)} ${n3(y)} ${i ? "l" : "m"}`).join("\n") +
              (p.length === 1 ? ` ${n3(p[0][0])} ${n3(p[0][1])} l` : "") +
              "\nS\n"
          )
          .join("")
      own = {
        Subtype: "Ink",
        Rect: rect,
        InkList: m.paths.map((p) => p.flat()),
        BS: { W: m.width },
        AP: { N: appearance(ctx, rect, body, {}, m.opacity) },
      }
      break
    }
    case "rect":
    case "ellipse": {
      const [x1, y1, x2, y2] = m.rect
      const h = m.width / 2
      const inset: Box = [x1 + h, y1 + h, x2 - h, y2 - h]
      const body =
        stroke(m.color, m.width) +
        (m.kind === "rect"
          ? `${n3(inset[0])} ${n3(inset[1])} ${n3(inset[2] - inset[0])} ${n3(inset[3] - inset[1])} re S\n`
          : ellipse(inset))
      own = {
        Subtype: m.kind === "rect" ? "Square" : "Circle",
        Rect: m.rect,
        BS: { W: m.width },
        AP: { N: appearance(ctx, m.rect, body, {}, m.opacity) },
      }
      break
    }
    case "line":
    case "arrow": {
      const rect = box([m.a, m.b], Math.max(m.width, 8))
      let body = stroke(m.color, m.width) + `${n3(m.a[0])} ${n3(m.a[1])} m ${n3(m.b[0])} ${n3(m.b[1])} l S\n`
      if (m.kind === "arrow") {
        const [w1, w2] = arrowWings(m.a, m.b, m.width)
        body += `${n3(w1[0])} ${n3(w1[1])} m ${n3(m.b[0])} ${n3(m.b[1])} l ${n3(w2[0])} ${n3(w2[1])} l S\n`
      }
      own = {
        Subtype: "Line",
        Rect: rect,
        L: [...m.a, ...m.b],
        LE: ["None", m.kind === "arrow" ? "OpenArrow" : "None"],
        BS: { W: m.width },
        AP: { N: appearance(ctx, rect, body, {}, m.opacity) },
      }
      break
    }
    case "stamp": {
      const [x1, y1, x2, y2] = m.rect
      const image = await doc.embedPng(m.png)
      const body = `${n3(x2 - x1)} 0 0 ${n3(y2 - y1)} ${n3(x1)} ${n3(y1)} cm /Im Do\n`
      own = {
        Subtype: "Stamp",
        Name: "Nimbus",
        Rect: m.rect,
        NimbusPng: ctx.register(ctx.stream(m.png)),
        AP: { N: appearance(ctx, m.rect, body, { XObject: { Im: image.ref } }, m.opacity) },
      }
      break
    }
  }
  return ctx.register(ctx.obj({ ...base, ...own } as { [k: string]: never }))
}

// Replaces every supported annotation in `bytes` with `marks`. Foreign annotations stay as they are.
export async function writeMarks(bytes: Uint8Array, marks: Mark[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { context: ctx } = doc
  const pages = doc.getPages()

  for (const page of pages) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i)
      const a = annots.lookup(i)
      if (!(a instanceof PDFDict) || !ours(a)) continue
      annots.remove(i)
      // Drop what only this annotation used, so repeated saves don't pile up orphans, and its popup.
      const popup = a.get(PDFName.of("Popup"))
      if (popup instanceof PDFRef) {
        for (let j = annots.size() - 1; j >= 0; j--) if (annots.get(j) === popup) annots.remove(j)
        ctx.delete(popup)
      }
      const ap = a.lookup(PDFName.of("AP"))
      const n = ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : undefined
      const res = n instanceof PDFRawStream ? n.dict.lookup(PDFName.of("Resources")) : undefined
      const pics = res instanceof PDFDict ? res.lookup(PDFName.of("XObject")) : undefined
      if (a.has(PDFName.of("NimbusPng")) && pics instanceof PDFDict)
        for (const [, pic] of pics.entries()) {
          if (!(pic instanceof PDFRef)) continue
          const mask = (ctx.lookup(pic) as PDFRawStream).dict.get(PDFName.of("SMask"))
          if (mask instanceof PDFRef) ctx.delete(mask)
          ctx.delete(pic)
        }
      for (const dead of [ap instanceof PDFDict ? ap.get(PDFName.of("N")) : undefined, a.get(PDFName.of("NimbusPng"))])
        if (dead instanceof PDFRef) ctx.delete(dead)
      if (ref instanceof PDFRef) ctx.delete(ref)
    }
  }

  let font: PDFRef | undefined
  // Free text names its font /Helv, which the AcroForm's default resources must be able to find.
  const helv = () => {
    if (font) return font
    let form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)
    if (!form) {
      form = ctx.obj({ Fields: [] })
      doc.catalog.set(PDFName.of("AcroForm"), form)
    }
    let dr = form.lookupMaybe(PDFName.of("DR"), PDFDict)
    if (!dr) form.set(PDFName.of("DR"), (dr = ctx.obj({})))
    let fonts = dr.lookupMaybe(PDFName.of("Font"), PDFDict)
    if (!fonts) dr.set(PDFName.of("Font"), (fonts = ctx.obj({})))
    const had = fonts.get(PDFName.of("Helv"))
    font =
      had instanceof PDFRef
        ? had
        : ctx.register(
            ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" })
          )
    if (!had) fonts.set(PDFName.of("Helv"), font)
    return font
  }

  for (const m of marks) {
    const page = pages[m.page]
    if (!page) continue
    const ref = await annotation(doc, m, helv)
    let annots = page.node.Annots()
    if (!annots) page.node.set(PDFName.of("Annots"), (annots = ctx.obj([])))
    annots.push(ref)
  }
  return doc.save({ useObjectStreams: false })
}

// An annotation of a subtype we own. A Stamp is ours only when it carries our PNG, so a foreign stamp stays untouched.
function ours(a: PDFDict) {
  const sub = a.lookup(PDFName.of("Subtype"))
  if (!(sub instanceof PDFName)) return false
  const name = sub.decodeText()
  return SUPPORTED.has(name) || (name === "Stamp" && a.has(PDFName.of("NimbusPng")))
}

// ---- Reading ----

function colorOf(a: PDFDict) {
  const c = nums(a.lookup(PDFName.of("C")))
  if (c.length === 1) return hex([c[0], c[0], c[0]])
  if (c.length === 4) return hex([0, 1, 2].map((i) => (1 - c[i]) * (1 - c[3])))
  return c.length === 3 ? hex(c) : "#000000"
}

function widthOf(a: PDFDict) {
  const bs = a.lookup(PDFName.of("BS"))
  const w = bs instanceof PDFDict ? bs.lookup(PDFName.of("W")) : undefined
  if (w instanceof PDFNumber) return w.asNumber()
  const border = nums(a.lookup(PDFName.of("Border")))
  return border.length >= 3 ? border[2] : 1
}

const pair = (v: number[], i: number): Pt => [v[i], v[i + 1]]
const norm = (v: number[]): Box => [
  Math.min(v[0], v[2]),
  Math.min(v[1], v[3]),
  Math.max(v[0], v[2]),
  Math.max(v[1], v[3]),
]

function lift(a: PDFDict, page: number): Mark | null {
  const sub = (a.lookup(PDFName.of("Subtype")) as PDFName | undefined)?.decodeText()
  const rect = norm(nums(a.lookup(PDFName.of("Rect"))))
  const contents = decode(a.lookup(PDFName.of("Contents")))
  const author = decode(a.lookup(PDFName.of("T")))
  const ca = a.lookup(PDFName.of("CA"))
  const common = {
    page,
    color: colorOf(a),
    ...(ca instanceof PDFNumber && { opacity: ca.asNumber() }),
    ...(author !== undefined && { author }),
    ...(contents !== undefined && { contents }),
  }
  switch (sub) {
    case "Highlight":
    case "Underline":
    case "StrikeOut": {
      const q = nums(a.lookup(PDFName.of("QuadPoints")))
      const quads: Box[] = []
      for (let i = 0; i + 8 <= q.length; i += 8) {
        const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]]
        const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]]
        quads.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
      }
      return {
        ...common,
        kind: sub === "Highlight" ? "highlight" : sub === "Underline" ? "underline" : "strike",
        quads: quads.length ? quads : [rect],
      }
    }
    case "Text":
      return { ...common, kind: "note", at: [rect[0], rect[1]] }
    case "FreeText": {
      const da = decode(a.lookup(PDFName.of("DA"))) ?? ""
      const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 12
      const col = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da)
      const gray = /([\d.]+)\s+g\b/.exec(da)
      return {
        ...common,
        kind: "text",
        rect,
        size,
        color: col ? hex([+col[1], +col[2], +col[3]]) : gray ? hex([+gray[1], +gray[1], +gray[1]]) : "#000000",
      }
    }
    case "Ink": {
      const list = a.lookup(PDFName.of("InkList"))
      const paths =
        list instanceof PDFArray
          ? list.asArray().map((p) => {
              const v = nums(p instanceof PDFRef ? a.context.lookup(p) : p)
              return Array.from({ length: Math.floor(v.length / 2) }, (_, i) => pair(v, i * 2))
            })
          : []
      return paths.length ? { ...common, kind: "ink", width: widthOf(a), paths } : null
    }
    case "Square":
    case "Circle":
      return { ...common, kind: sub === "Square" ? "rect" : "ellipse", rect, width: widthOf(a) }
    case "Line": {
      const l = nums(a.lookup(PDFName.of("L")))
      if (l.length < 4) return null
      const le = a.lookup(PDFName.of("LE"))
      const ends = le instanceof PDFArray ? le.asArray().map((e) => (e instanceof PDFName ? e.decodeText() : "")) : []
      const arrow = ends.some((e) => e.endsWith("Arrow"))
      return { ...common, kind: arrow ? "arrow" : "line", a: pair(l, 0), b: pair(l, 2), width: widthOf(a) }
    }
    case "Stamp": {
      const png = a.lookup(PDFName.of("NimbusPng"))
      return png instanceof PDFRawStream
        ? { ...common, kind: "stamp", rect, png: new Uint8Array(png.contents) }
        : null
    }
  }
  return null
}

// Every supported annotation in the file, page by page.
export async function readMarks(bytes: Uint8Array): Promise<Mark[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const marks: Mark[] = []
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots()
    for (let i = 0; annots && i < annots.size(); i++) {
      const a = annots.lookup(i)
      const m = a instanceof PDFDict && ours(a) ? lift(a, index) : null
      if (m) marks.push(m)
    }
  })
  return marks
}
