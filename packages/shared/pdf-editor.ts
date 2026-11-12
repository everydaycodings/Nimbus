import {
  NOTE_SIZE,
  TEXT_LEADING,
  TEXT_PAD,
  arrowWings,
  readMarks,
  writeMarks,
  type Box,
  type Mark,
  type Pt,
} from "./pdf-annot.ts"

// A framework-free PDF editor: pages drawn by pdf.js (canvas, text layer, and its form fields), our marks drawn over
// them as SVG, and every mark kept in a model of our own (pdf-annot.ts) that save() writes back as real annotations.
// pdf.js is injected so the web app and the Android WebView each load their own build. The host must load
// pdfjs-dist/web/pdf_viewer.css and give `container` a fixed height and `overflow: auto` (it is the scroller).
// Works with mouse, finger and pen. With a drawing tool on, one finger draws instead of scrolling: switch to
// "select" to scroll (pinch still zooms).

type Pdfjs = typeof import("pdfjs-dist")

export type Tool =
  | "select"
  | "highlight"
  | "underline"
  | "strike"
  | "note"
  | "text"
  | "pen"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "eraser"
  | "stamp"

export type EditorState = {
  /** Marks or form fields changed since the file was opened. */
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  tool: Tool
  /** Kind of the selected mark, if one is. */
  selected: Mark["kind"] | null
  pages: number
}

export type EditorOptions = {
  container: HTMLElement
  pdfjs: Pdfjs
  data: Uint8Array
  /** Written as the author (/T) of marks made here. */
  author?: string
  /** Extra getDocument() options (cMapUrl, standardFontDataUrl, ...). */
  docOptions?: Record<string, unknown>
  onChange?: (state: EditorState) => void
}

type Layers = {
  canvas: HTMLCanvasElement
  text: HTMLElement
  annot: HTMLElement
  task: { cancel(): void } | null
}
type Pg = {
  i: number
  // pdf.js page and viewport; typed loosely, the parts we use are small and stable.
  page: any
  vp: any
  el: HTMLElement
  svg: SVGSVGElement
  layers?: Layers
}
type Drag =
  | { kind: "draw"; pg: Pg; before: Mark[]; start: Pt; moved: boolean }
  | { kind: "place"; pg: Pg; at: Pt }
  | { kind: "move"; pg: Pg; before: Mark[]; start: Pt; i: number; moved: boolean; wasSelected: boolean }
  | { kind: "resize"; pg: Pg; before: Mark[]; i: number; corner: string }
  | { kind: "erase"; pg: Pg; before: Mark[] }

const DRAWN = new Set<Tool>(["note", "text", "pen", "rect", "ellipse", "line", "arrow", "eraser", "stamp"])
const MARKUP = new Set<Tool>(["highlight", "underline", "strike"])
const RESIZABLE = new Set(["text", "rect", "ellipse", "stamp"])
const KEEP_ASPECT = new Set(["text", "stamp"])
const PAD = 8
const HANDLE = 22

// The layers fill their page: pdf.js sizes them with CSS round(), which older WebViews (Chrome < 125) drop.
const CSS = `
.nbpe{background:#6b7280;padding:${PAD}px 0;outline:none;-webkit-tap-highlight-color:transparent}
.nbpe .page{margin:0 auto ${PAD}px;position:relative;border:0;background:#fff;box-shadow:0 1px 4px rgb(0 0 0/.35)}
.nbpe .page>canvas{position:absolute;inset:0;width:100%;height:100%}
.nbpe .textLayer{z-index:1}
.nbpe .annotationLayer{z-index:2;pointer-events:none;inset:0;width:100%!important;height:100%!important}
.nbpe .annotationLayer section{pointer-events:auto}
.nbpe-svg{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:hidden}
.nbpe-svg .hit{pointer-events:none}
.nbpe-select .nbpe-svg .hit{pointer-events:all;touch-action:none;cursor:move}
.nbpe-select .nbpe-svg .hs{pointer-events:stroke}
.nbpe-svg [data-h]{pointer-events:all;touch-action:none}
.nbpe-cap{position:absolute;inset:0;z-index:4;display:none;touch-action:pinch-zoom}
.nbpe-draw .nbpe-cap{display:block;cursor:crosshair;touch-action:none}
.nbpe-t-text .nbpe-cap,.nbpe-t-note .nbpe-cap{cursor:text}
.nbpe-t-eraser .nbpe-cap{cursor:cell}
.nbpe-edit{position:absolute;z-index:5;margin:0;padding:0;border:1px dashed #3b82f6;background:rgb(255 255 255/.85);resize:none;overflow:hidden;font-family:Helvetica,Arial,sans-serif;line-height:${TEXT_LEADING};outline:none}
.nbpe-note-edit{padding:6px;font-size:14px;line-height:1.35;width:220px;height:96px;background:#fffbe6;color:#111;border:1px solid #d1b100;border-radius:6px;box-shadow:0 4px 14px rgb(0 0 0/.3)}
`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const normBox = (a: Pt, b: Pt): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
const inBox = (p: Pt, b: Box, pad = 0) => p[0] >= b[0] - pad && p[0] <= b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[3] + pad
const distSeg = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = dx || dy ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function bounds(m: Mark): Box | null {
  switch (m.kind) {
    case "note":
      return [m.at[0], m.at[1], m.at[0] + NOTE_SIZE, m.at[1] + NOTE_SIZE]
    case "text":
    case "rect":
    case "ellipse":
    case "stamp":
      return m.rect
    case "ink": {
      const [xs, ys] = [m.paths.flat().map((p) => p[0]), m.paths.flat().map((p) => p[1])]
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    case "line":
    case "arrow":
      return normBox(m.a, m.b)
    default:
      return null
  }
}

function shift(m: Mark, dx: number, dy: number): Mark {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy]
  const mb = (b: Box): Box => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]
  switch (m.kind) {
    case "note":
      return { ...m, at: mv(m.at) }
    case "text":
    case "rect":
    case "ellipse":
    case "stamp":
      return { ...m, rect: mb(m.rect) }
    case "ink":
      return { ...m, paths: m.paths.map((p) => p.map(mv)) }
    case "line":
    case "arrow":
      return { ...m, a: mv(m.a), b: mv(m.b) }
    default:
      return { ...m, quads: m.quads.map(mb) }
  }
}

// Is `p` (PDF space) on this mark, within `tol` points?
function hits(m: Mark, p: Pt, tol: number) {
  switch (m.kind) {
    case "highlight":
    case "underline":
    case "strike":
      return m.quads.some((q) => inBox(p, q, tol / 2))
    case "note":
    case "text":
    case "stamp":
      return inBox(p, bounds(m)!, tol / 2)
    case "ink":
      return m.paths.some((path) => path.some((q, i) => distSeg(p, path[i - 1] ?? q, q) <= tol + m.width / 2))
    case "line":
    case "arrow":
      return distSeg(p, m.a, m.b) <= tol + m.width / 2
    case "rect": {
      const [x1, y1, x2, y2] = m.rect
      return inBox(p, m.rect, tol) && !inBox(p, [x1 + tol, y1 + tol, x2 - tol, y2 - tol])
    }
    case "ellipse": {
      const [x1, y1, x2, y2] = m.rect
      const rx = (x2 - x1) / 2 + tol
      const ry = (y2 - y1) / 2 + tol
      const r = Math.hypot((p[0] - (x1 + x2) / 2) / rx, (p[1] - (y1 + y2) / 2) / ry)
      return r <= 1 && r >= 1 - (2 * tol) / Math.min(rx, ry)
    }
  }
}

const linesOf = (m: { contents?: string }) => (m.contents ?? "").split("\n")

let measureCtx: CanvasRenderingContext2D | null = null
function textBox(contents: string, size: number): [number, number] {
  measureCtx ??= document.createElement("canvas").getContext("2d")!
  measureCtx.font = `${size}px Helvetica, Arial, sans-serif`
  const lines = contents.split("\n")
  return [
    Math.max(...lines.map((l) => measureCtx!.measureText(l).width)) + 2 * TEXT_PAD + 1,
    lines.length * size * TEXT_LEADING + 2 * TEXT_PAD,
  ]
}

// Natural size of a PNG, from its IHDR.
function pngSize(png: Uint8Array): [number, number] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return [v.getUint32(16), v.getUint32(20)]
}

export class PdfEditor {
  private marks: Mark[] = []
  private initial: Mark[] = []
  private past: Mark[][] = []
  private future: Mark[][] = []
  private sel: number | null = null
  private tool: Tool = "select"
  private color = "#ef4444"
  private width = 3
  private zoom = 1
  private stamp: Uint8Array | null = null
  private draft: Mark | null = null
  private editing: number | null = null
  private formsDirty = false
  private drag: Drag | null = null
  private touched = "mouse"
  private pgs: Pg[] = []
  private urls = new WeakMap<Uint8Array, string>()
  private allUrls: string[] = []
  private io: IntersectionObserver
  private ro: ResizeObserver
  private lastWidth = 0
  private timer = 0
  private style: HTMLStyleElement
  private ac = new AbortController()

  private constructor(
    private o: EditorOptions,
    private doc: import("pdfjs-dist").PDFDocumentProxy
  ) {
    const { container } = o
    this.style = document.head.appendChild(Object.assign(document.createElement("style"), { textContent: CSS }))
    container.replaceChildren()
    container.classList.add("nbpe", "pdfViewer")
    container.tabIndex = -1
    this.io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const pg = this.pgs[Number((e.target as HTMLElement).dataset.page)]
          if (e.isIntersecting) void this.paint(pg)
          else this.unpaint(pg)
        }
      },
      { root: container, rootMargin: "900px 0px" }
    )
    this.ro = new ResizeObserver(() => {
      if (container.clientWidth === this.lastWidth) return
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.layout(), 120)
    })
    this.ro.observe(container)
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void) =>
      container.addEventListener(t, f, { signal: this.ac.signal })
    on("pointerdown", (e) => this.down(e))
    on("pointermove", (e) => this.move(e))
    on("pointerup", (e) => {
      this.up(e, true)
      // A mouse selection is done when the button comes up; touch waits for the handles (selectionChanged).
      if (e.pointerType === "mouse" && MARKUP.has(this.tool)) setTimeout(() => this.markSelection())
    })
    on("pointercancel", (e) => this.up(e, false))
    on("keydown", (e) => this.key(e))
    document.addEventListener("selectionchange", () => this.selectionChanged(), { signal: this.ac.signal })
    ;(doc.annotationStorage as { onSetModified: (() => void) | null }).onSetModified = () => {
      this.formsDirty = true
      this.emit()
    }
    this.applyClasses()
  }

  /** Opens `data`. Rejects when the file can't be read (encrypted, damaged). */
  static async open(o: EditorOptions) {
    let data = o.data
    const marks = await readMarks(data)
    // pdf.js gets the file without our marks (we draw those), so nothing is painted twice.
    if (marks.length) data = await writeMarks(data, [])
    const doc = await o.pdfjs.getDocument({ ...o.docOptions, data: data.slice() }).promise
    const ed = new PdfEditor(o, doc)
    ed.marks = ed.initial = marks
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
    ed.pgs = pages.map((page, i) => {
      const el = document.createElement("div")
      el.className = "page"
      el.dataset.page = String(i)
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      svg.setAttribute("class", "nbpe-svg")
      const cap = document.createElement("div")
      cap.className = "nbpe-cap"
      el.append(svg, cap)
      o.container.append(el)
      return { i, page, vp: null, el, svg }
    })
    ed.layout()
    ed.emit()
    return ed
  }

  get pageCount() {
    return this.pgs.length
  }
  get dirty() {
    return this.marks !== this.initial || this.formsDirty
  }

  // ---- Settings ----

  setTool(t: Tool) {
    this.finishEdit()
    this.tool = t
    this.sel = null
    this.applyClasses()
    this.redrawAll()
    this.emit()
  }
  setColor(c: string) {
    this.color = c
    const m = this.sel !== null ? this.marks[this.sel] : null
    if (m) this.commit(this.marks.map((x) => (x === m ? { ...x, color: c } : x)))
  }
  /** Stroke width in points; free text is four times this as its font size in points. */
  setWidth(w: number) {
    this.width = w
  }
  /** 1 fits the width of the widest page. */
  setZoom(z: number) {
    this.zoom = clamp(z, 0.5, 4)
    this.layout()
  }
  /** Arms placing a picture (a signature): the next click or tap puts it there. */
  setStamp(png: Uint8Array) {
    this.stamp = png
    this.setTool("stamp")
  }

  // ---- History ----

  private emit() {
    this.o.onChange?.({
      dirty: this.dirty,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      tool: this.tool,
      selected: this.sel !== null ? (this.marks[this.sel]?.kind ?? null) : null,
      pages: this.pgs.length,
    })
  }
  private commit(next: Mark[], before = this.marks) {
    this.past.push(before)
    this.future = []
    this.marks = next
    this.redrawAll()
    this.emit()
  }
  undo() {
    this.finishEdit()
    const p = this.past.pop()
    if (!p) return
    this.future.push(this.marks)
    this.marks = p
    this.sel = null
    this.redrawAll()
    this.emit()
  }
  redo() {
    const n = this.future.pop()
    if (!n) return
    this.past.push(this.marks)
    this.marks = n
    this.sel = null
    this.redrawAll()
    this.emit()
  }
  /** Removes the selected mark. */
  deleteSelected() {
    if (this.sel === null) return
    const i = this.sel
    this.sel = null
    this.commit(this.marks.filter((_, j) => j !== i))
  }

  /** The PDF with every mark in it as a real annotation, form values included. */
  async save() {
    this.finishEdit()
    return writeMarks(await this.doc.saveDocument(), this.marks)
  }

  destroy() {
    this.ac.abort()
    this.io.disconnect()
    this.ro.disconnect()
    clearTimeout(this.timer)
    this.pgs.forEach((p) => this.unpaint(p))
    this.allUrls.forEach((u) => URL.revokeObjectURL(u))
    this.style.remove()
    this.o.container.replaceChildren()
    this.o.container.classList.remove("nbpe", "pdfViewer")
    void this.doc.loadingTask.destroy()
  }

  // ---- Pages ----

  private applyClasses() {
    const c = this.o.container
    c.className = c.className.replace(/\bnbpe-\S+/g, "").trim()
    c.classList.add(`nbpe-t-${this.tool}`)
    if (this.tool === "select") c.classList.add("nbpe-select")
    if (DRAWN.has(this.tool)) c.classList.add("nbpe-draw")
  }

  private layout() {
    const c = this.o.container
    this.lastWidth = c.clientWidth
    const widest = Math.max(...this.pgs.map((p) => p.page.getViewport({ scale: 1 }).width))
    const scale = (Math.max(160, c.clientWidth - 2 * PAD) / widest) * this.zoom
    for (const pg of this.pgs) {
      pg.vp = pg.page.getViewport({ scale })
      pg.el.style.width = `${pg.vp.width}px`
      pg.el.style.height = `${pg.vp.height}px`
      pg.el.style.setProperty("--scale-factor", String(scale))
      pg.svg.setAttribute("viewBox", `0 0 ${pg.vp.width} ${pg.vp.height}`)
      this.unpaint(pg)
      this.io.unobserve(pg.el)
      this.io.observe(pg.el)
      this.draw(pg)
    }
  }

  private async paint(pg: Pg) {
    if (pg.layers) return
    const { pdfjs } = this.o
    const vp = pg.vp
    const canvas = document.createElement("canvas")
    const text = document.createElement("div")
    text.className = "textLayer"
    const annot = document.createElement("div")
    annot.className = "annotationLayer"
    const layers: Layers = (pg.layers = { canvas, text, annot, task: null })
    pg.el.prepend(canvas, text, annot)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    // Checkboxes and radios draw their on/off looks into their own canvases, handed to the field layer here.
    const canvasMap = new Map<string, HTMLCanvasElement>()
    try {
      const task = pg.page.render({
        canvasContext: canvas.getContext("2d")!,
        viewport: vp,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
        annotationCanvasMap: canvasMap,
      } as never)
      layers.task = task
      await task.promise
      await new pdfjs.TextLayer({ textContentSource: pg.page.streamTextContent(), container: text, viewport: vp }).render()
      // Fields only; links and the rest would get in the way of text selection and marks.
      const fields = (await pg.page.getAnnotations({ intent: "display" })).filter(
        (a: { annotationType: number }) => a.annotationType === pdfjs.AnnotationType.WIDGET
      )
      if (pg.layers !== layers) return
      await new pdfjs.AnnotationLayer({
        div: annot,
        page: pg.page,
        viewport: vp.clone({ dontFlip: true }),
        accessibilityManager: null,
        annotationCanvasMap: canvasMap,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        linkService: {},
        annotationStorage: this.doc.annotationStorage,
      } as never).render({
        annotations: fields,
        imageResourcesPath: "",
        renderForms: true,
        downloadManager: null,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: null,
      } as never)
    } catch {
      // A cancelled render (the page scrolled away or was resized) is normal; a broken page stays blank.
    }
  }

  private unpaint(pg: Pg) {
    const l = pg.layers
    if (!l) return
    l.task?.cancel()
    l.canvas.remove()
    l.text.remove()
    l.annot.remove()
    pg.layers = undefined
  }

  // ---- Drawing the marks ----

  private redrawAll() {
    this.pgs.forEach((p) => this.draw(p))
  }

  private url(png: Uint8Array) {
    let u = this.urls.get(png)
    if (!u) {
      u = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }))
      this.urls.set(png, u)
      this.allUrls.push(u)
    }
    return u
  }

  private draw(pg: Pg) {
    if (!pg.vp) return
    const s = pg.vp.scale
    const P = (p: Pt) => pg.vp.convertToViewportPoint(p[0], p[1]) as Pt
    const R = (b: Box) => {
      const [a, c] = [P([b[0], b[1]]), P([b[2], b[3]])]
      const [x, y] = [Math.min(a[0], c[0]), Math.min(a[1], c[1])]
      return { x, y, w: Math.abs(a[0] - c[0]), h: Math.abs(a[1] - c[1]) }
    }
    const rectAttr = (b: Box) => {
      const r = R(b)
      return `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"`
    }
    const hit = (b: Box) => `<rect class="hit" ${rectAttr(b)} fill="transparent"/>`
    const line = (a: Pt, b: Pt) => {
      const [p, q] = [P(a), P(b)]
      return `M${p[0]} ${p[1]}L${q[0]} ${q[1]}`
    }
    const out: string[] = []
    const list: [Mark, number][] = this.marks.map((m, i) => [m, i])
    if (this.draft) list.push([this.draft, -1])
    for (const [m, i] of list) {
      if (m.page !== pg.i || i === this.editing) continue
      const op = m.opacity !== undefined ? ` opacity="${m.opacity}"` : ""
      const stroke = (w: number) => `fill="none" stroke="${m.color}" stroke-width="${w * s}" stroke-linecap="round" stroke-linejoin="round"${op}`
      const twin = (d: string, w: number) =>
        `<path class="hit hs" d="${d}" fill="none" stroke="rgba(0,0,0,.001)" stroke-width="${Math.max(w * s, 16)}" stroke-linecap="round"/>`
      let body = ""
      switch (m.kind) {
        case "highlight":
          // The overlay is its own stacking context, so multiply can't reach the page; the saved PDF uses multiply.
          body = m.quads.map((q) => `<rect ${rectAttr(q)} fill="${m.color}" fill-opacity=".4"${op}/>`).join("")
          break
        case "underline":
        case "strike":
          body = m.quads
            .map((q) => {
              const y = m.kind === "underline" ? q[1] + 1 : (q[1] + q[3]) / 2
              return `<path d="${line([q[0], y], [q[2], y])}" ${stroke(1)}/>`
            })
            .join("")
          break
        case "note": {
          const r = R(bounds(m)!)
          body = `<rect x="${r.x + s}" y="${r.y + s}" width="${r.w - 2 * s}" height="${r.h - 2 * s}" fill="${m.color}" stroke="#000" stroke-width="${0.8 * s}"${op}/>`
          for (const d of [6, 10, 14]) body += `<path d="M${r.x + 5 * s} ${r.y + d * s}H${r.x + r.w - 5 * s}" stroke="#000" stroke-width="${0.8 * s}"/>`
          body += hit(bounds(m)!)
          break
        }
        case "text": {
          const r = R(m.rect)
          body =
            `<text font-family="Helvetica, Arial, sans-serif" font-size="${m.size * s}" fill="${m.color}"${op}>` +
            linesOf(m)
              .map((l, k) => `<tspan x="${r.x + TEXT_PAD * s}" y="${r.y + (TEXT_PAD + m.size * 0.92 + k * m.size * TEXT_LEADING) * s}" xml:space="preserve">${esc(l)}</tspan>`)
              .join("") +
            "</text>" +
            hit(m.rect)
          break
        }
        case "ink": {
          const d = m.paths.map((p) => p.map((q, k) => `${k ? "L" : "M"}${P(q)[0]} ${P(q)[1]}`).join("") + (p.length === 1 ? `l0 0` : "")).join("")
          body = `<path d="${d}" ${stroke(m.width)}/>` + twin(d, m.width)
          break
        }
        case "rect":
          body = `<rect ${rectAttr(m.rect)} ${stroke(m.width)}/><rect class="hit hs" ${rectAttr(m.rect)} fill="none" stroke="rgba(0,0,0,.001)" stroke-width="${Math.max(m.width * s, 16)}"/>`
          break
        case "ellipse": {
          const r = R(m.rect)
          const at = `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"`
          body = `<ellipse ${at} ${stroke(m.width)}/><ellipse class="hit hs" ${at} fill="none" stroke="rgba(0,0,0,.001)" stroke-width="${Math.max(m.width * s, 16)}"/>`
          break
        }
        case "line":
        case "arrow": {
          let d = line(m.a, m.b)
          if (m.kind === "arrow") {
            const [w1, w2] = arrowWings(m.a, m.b, m.width)
            d += `M${P(w1)[0]} ${P(w1)[1]}L${P(m.b)[0]} ${P(m.b)[1]}L${P(w2)[0]} ${P(w2)[1]}`
          }
          body = `<path d="${d}" ${stroke(m.width)}/>` + twin(line(m.a, m.b), m.width)
          break
        }
        case "stamp": {
          const r = R(m.rect)
          body = `<image href="${this.url(m.png)}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="none"${op}/>` + hit(m.rect)
          break
        }
      }
      out.push(`<g data-i="${i}">${body}</g>`)
    }
    const m = this.sel !== null ? this.marks[this.sel] : null
    const b = m && m.page === pg.i && this.sel !== this.editing ? bounds(m) : null
    if (m && b) {
      const pad = m.kind === "ink" || m.kind === "line" || m.kind === "arrow" ? 6 : 0
      const r = R(b)
      out.push(`<rect x="${r.x - pad}" y="${r.y - pad}" width="${r.w + 2 * pad}" height="${r.h + 2 * pad}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5 3"/>`)
      if (RESIZABLE.has(m.kind))
        for (const [cx, cy] of [[0, 1], [2, 1], [0, 3], [2, 3]] as const) {
          const [x, y] = P([b[cx], b[cy]])
          out.push(
            `<g data-h="${cx}${cy}"><rect x="${x - HANDLE / 2}" y="${y - HANDLE / 2}" width="${HANDLE}" height="${HANDLE}" fill="transparent"/><rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2" fill="#fff" stroke="#3b82f6" stroke-width="1.5"/></g>`
          )
        }
    }
    pg.svg.innerHTML = out.join("")
  }

  // ---- Pointer ----

  private pageOf(t: EventTarget | null) {
    const el = (t as Element | null)?.closest?.(".page") as HTMLElement | null
    return el ? this.pgs[Number(el.dataset.page)] : null
  }
  private at(pg: Pg, e: PointerEvent): Pt {
    const r = pg.el.getBoundingClientRect()
    return pg.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top) as Pt
  }
  private tol(pg: Pg) {
    return 8 / pg.vp.scale
  }

  private down(e: PointerEvent) {
    this.touched = e.pointerType
    if (e.button > 0 || (e.target as Element).closest?.(".nbpe-edit")) return
    const pg = this.pageOf(e.target)
    if (!pg) return
    const target = e.target as Element
    const c = this.o.container
    if (this.tool === "select") {
      const h = target.closest("[data-h]") as HTMLElement | null
      const g = target.closest("g[data-i]") as Element | null
      if (h && this.sel !== null) {
        this.drag = { kind: "resize", pg, before: this.marks, i: this.sel, corner: h.dataset.h! }
      } else if (g) {
        const i = Number(g.getAttribute("data-i"))
        this.drag = { kind: "move", pg, before: this.marks, start: this.at(pg, e), i, moved: false, wasSelected: this.sel === i }
        this.sel = i
        this.redrawAll()
        this.emit()
      } else {
        if (this.sel !== null) {
          this.sel = null
          this.redrawAll()
          this.emit()
        }
        return
      }
      c.setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    if (!DRAWN.has(this.tool) || !target.classList.contains("nbpe-cap")) return
    e.preventDefault()
    c.setPointerCapture(e.pointerId)
    const p = this.at(pg, e)
    const base = { page: pg.i, color: this.color }
    switch (this.tool) {
      case "note":
      case "text":
      case "stamp":
        this.drag = { kind: "place", pg, at: p }
        return
      case "eraser":
        this.drag = { kind: "erase", pg, before: this.marks }
        this.erase(pg, p)
        return
      case "pen":
        this.draft = { ...base, kind: "ink", width: this.width, paths: [[p]] }
        break
      case "rect":
      case "ellipse":
        this.draft = { ...base, kind: this.tool, width: this.width, rect: [...p, ...p] }
        break
      case "line":
      case "arrow":
        this.draft = { ...base, kind: this.tool, width: this.width, a: p, b: p }
        break
    }
    this.drag = { kind: "draw", pg, before: this.marks, start: p, moved: false }
    this.draw(pg)
  }

  private move(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    const p = this.at(d.pg, e)
    switch (d.kind) {
      case "draw": {
        const m = this.draft!
        if (m.kind === "ink") {
          const path = m.paths[0]
          const last = path[path.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) * d.pg.vp.scale < 1.5) return
          this.draft = { ...m, paths: [[...path, p]] }
        } else if (m.kind === "rect" || m.kind === "ellipse") this.draft = { ...m, rect: normBox(d.start, p) }
        else if (m.kind === "line" || m.kind === "arrow") this.draft = { ...m, b: p }
        d.moved = Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) * d.pg.vp.scale > 3 || d.moved
        this.draw(d.pg)
        return
      }
      case "move": {
        const dx = p[0] - d.start[0]
        const dy = p[1] - d.start[1]
        if (!d.moved && Math.hypot(dx, dy) * d.pg.vp.scale < 4) return
        d.moved = true
        this.marks = d.before.map((m, i) => (i === d.i ? shift(m, dx, dy) : m))
        this.draw(d.pg)
        return
      }
      case "resize": {
        const m = d.before[d.i]
        const b = bounds(m)!
        // The dragged corner is named by which of x1/x2 and y1/y2 it holds; the opposite one stays put.
        const fx = d.corner[0] === "0" ? 2 : 0
        const fy = d.corner[1] === "1" ? 3 : 1
        const ox = b[fx]
        const oy = b[fy]
        let next: Box
        let size: number | undefined
        if (KEEP_ASPECT.has(m.kind)) {
          const w = b[2] - b[0]
          const h = b[3] - b[1]
          const r = clamp(Math.max(Math.abs(p[0] - ox) / w, Math.abs(p[1] - oy) / h), 0.2, 8)
          const sx = d.corner[0] === "0" ? -1 : 1
          const sy = d.corner[1] === "1" ? -1 : 1
          next = normBox([ox, oy], [ox + sx * w * r, oy + sy * h * r])
          if (m.kind === "text") size = m.size * r
        } else next = normBox([ox, oy], p)
        const min = 6 / d.pg.vp.scale
        if (next[2] - next[0] < min || next[3] - next[1] < min) return
        this.marks = d.before.map((x, i) => (i === d.i && (x.kind === "text" || x.kind === "stamp" || x.kind === "rect" || x.kind === "ellipse") ? { ...x, rect: next, ...(size ? { size } : {}) } : x))
        this.draw(d.pg)
        return
      }
      case "erase":
        this.erase(d.pg, p)
    }
  }

  private up(e: PointerEvent, ok: boolean) {
    const d = this.drag
    this.drag = null
    if (!d) return
    const c = this.o.container
    if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId)
    if (!ok) {
      this.marks = "before" in d ? d.before : this.marks
      this.draft = null
      return this.redrawAll()
    }
    switch (d.kind) {
      case "draw": {
        const m = this.draft!
        this.draft = null
        // A tap with a shape tool makes nothing; a tap with the pen makes a dot.
        if (m.kind === "ink" || d.moved) {
          this.sel = null
          this.commit([...d.before, this.withAuthor(m)], d.before)
        } else this.draw(d.pg)
        return
      }
      case "place":
        return this.place(d.pg, d.at)
      case "move": {
        if (d.moved) {
          const next = this.marks
          this.marks = d.before
          this.commit(next, d.before)
        } else if (d.wasSelected) {
          // A second tap on a selected note or text edits it.
          const m = this.marks[d.i]
          if (m.kind === "note" || m.kind === "text") this.edit(d.pg, d.i)
        }
        return
      }
      case "resize": {
        const next = this.marks
        this.marks = d.before
        this.commit(next, d.before)
        return
      }
      case "erase":
        if (this.marks !== d.before) {
          const next = this.marks
          this.marks = d.before
          this.commit(next, d.before)
        }
    }
  }

  private withAuthor(m: Mark): Mark {
    return this.o.author ? { ...m, author: this.o.author } : m
  }

  private erase(pg: Pg, p: Pt) {
    const t = this.tol(pg)
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]
      if (m.page === pg.i && hits(m, p, t)) {
        this.marks = this.marks.filter((_, j) => j !== i)
        this.sel = null
        this.draw(pg)
        return
      }
    }
  }

  private place(pg: Pg, p: Pt) {
    if (this.tool === "stamp" && this.stamp) {
      const [nw, nh] = pngSize(this.stamp)
      const w = Math.min(150, (pg.vp.width / pg.vp.scale) * 0.4)
      const h = (w * nh) / nw
      this.addAndSelect({ kind: "stamp", page: pg.i, color: "#000000", rect: [p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2], png: this.stamp })
      this.setTool("select")
      this.sel = this.marks.length - 1
      this.redrawAll()
      this.emit()
    } else if (this.tool === "note") {
      this.edit(pg, null, { kind: "note", page: pg.i, color: "#facc15", at: [p[0], p[1] - NOTE_SIZE] })
    } else if (this.tool === "text") {
      this.edit(pg, null, { kind: "text", page: pg.i, color: this.color, rect: [p[0], p[1], p[0], p[1]], size: this.width * 4 })
    }
  }

  private addAndSelect(m: Mark) {
    this.sel = null
    this.commit([...this.marks, this.withAuthor(m)])
  }

  // ---- Typing text for a note or free text ----

  private input: HTMLTextAreaElement | null = null

  private edit(pg: Pg, i: number | null, fresh?: Mark) {
    this.finishEdit()
    const m = (i !== null ? this.marks[i] : fresh) as Mark & ({ kind: "note" } | { kind: "text" })
    const s = pg.vp.scale
    const box = this.input = document.createElement("textarea")
    box.setAttribute("aria-label", m.kind === "note" ? "Note text" : "Text to add")
    box.value = m.contents ?? ""
    let cancelled = false
    const [vx, vy] = pg.vp.convertToViewportPoint(m.kind === "note" ? m.at[0] : m.rect[0], m.kind === "note" ? m.at[1] + NOTE_SIZE : m.rect[3]) as Pt
    box.className = m.kind === "note" ? "nbpe-edit nbpe-note-edit" : "nbpe-edit"
    // A note near the right edge opens to the left, so the box stays on the page (220px + border).
    box.style.left = `${m.kind === "note" ? Math.max(0, Math.min(vx, pg.el.clientWidth - 224)) : vx}px`
    box.style.top = `${vy}px`
    if (m.kind === "text") {
      box.style.fontSize = `${m.size * s}px`
      box.style.color = m.color
      box.style.padding = `${TEXT_PAD * s}px`
      const fit = () => {
        const [w, h] = textBox(box.value || " ", m.size)
        box.style.width = `${Math.max(w, 60 / s) * s + 4}px`
        box.style.height = `${h * s}px`
      }
      box.addEventListener("input", fit)
      fit()
    }
    const done = () => {
      if (this.input !== box) return
      this.input = null
      const contents = box.value.replace(/\s+$/, "")
      box.remove()
      this.editing = null
      if (!cancelled && contents) {
        let next: Mark = { ...m, contents }
        if (next.kind === "text") {
          const [w, h] = textBox(contents, next.size)
          next = { ...next, rect: [next.rect[0], next.rect[3] - h, next.rect[0] + w, next.rect[3]] }
        }
        if (i !== null) this.commit(this.marks.map((x, j) => (j === i ? next : x)))
        else {
          this.commit([...this.marks, this.withAuthor(next)])
          this.sel = this.marks.length - 1
        }
      } else if (i !== null && !contents && !cancelled) this.deleteAt(i)
      this.redrawAll()
      this.emit()
    }
    box.addEventListener("blur", done)
    box.addEventListener("keydown", (e) => {
      e.stopPropagation()
      if (e.key === "Escape") {
        cancelled = true
        done()
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) done()
    })
    pg.el.append(box)
    this.editing = i
    this.redrawAll()
    box.focus()
  }

  private deleteAt(i: number) {
    this.sel = null
    this.commit(this.marks.filter((_, j) => j !== i))
  }

  private finishEdit() {
    this.input?.blur()
  }

  // ---- Highlight, underline and strike from the text selection ----

  private selTimer = 0
  private selectionChanged() {
    if (!MARKUP.has(this.tool) || this.touched === "mouse") return
    // A finger adjusts the selection with handles, so wait until it settles.
    clearTimeout(this.selTimer)
    this.selTimer = window.setTimeout(() => this.markSelection(), 600)
  }

  private markSelection() {
    const sel = getSelection()
    if (!sel?.rangeCount || sel.isCollapsed || !MARKUP.has(this.tool)) return
    const c = this.o.container
    const range = sel.getRangeAt(0)
    if (!c.contains(range.commonAncestorContainer)) return
    const added: Mark[] = []
    for (const pg of this.pgs) {
      if (!pg.layers) continue
      const pr = pg.el.getBoundingClientRect()
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1 && r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top)
        .map((r) => ({ l: r.left - pr.left, t: r.top - pr.top, r: r.right - pr.left, b: r.bottom - pr.top }))
        .sort((a, b) => a.t - b.t || a.l - b.l)
      // Drop boxes inside another one, and join pieces of the same line.
      const lines: typeof rects = []
      for (const r of rects) {
        const same = lines.find((q) => Math.abs(q.t - r.t) < (q.b - q.t) * 0.4 && r.l <= q.r + (q.b - q.t) * 0.6 && r.r >= q.l - (q.b - q.t) * 0.6)
        if (same) {
          same.l = Math.min(same.l, r.l)
          same.r = Math.max(same.r, r.r)
          same.t = Math.min(same.t, r.t)
          same.b = Math.max(same.b, r.b)
        } else lines.push({ ...r })
      }
      if (!lines.length) continue
      const quads = lines.map((q) => {
        const a = pg.vp.convertToPdfPoint(q.l, q.t) as Pt
        const b = pg.vp.convertToPdfPoint(q.r, q.b) as Pt
        return normBox(a, b)
      })
      added.push(this.withAuthor({ kind: this.tool as "highlight" | "underline" | "strike", page: pg.i, color: this.color, quads }))
    }
    sel.removeAllRanges()
    if (added.length) this.commit([...this.marks, ...added])
  }

  // ---- Keyboard ----

  private key(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    if (typing) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault()
      return e.shiftKey ? this.redo() : this.undo()
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault()
      return this.redo()
    }
    if (this.sel === null) return
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      this.deleteSelected()
    } else if (e.key === "Escape") {
      this.sel = null
      this.redrawAll()
      this.emit()
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0
      const i = this.sel
      this.commit(this.marks.map((m, j) => (j === i ? shift(m, dx, dy) : m)))
    }
  }
}
