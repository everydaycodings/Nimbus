// pdf.js, reading through the bridge by range, drawing only the pages near the screen.
// ponytail: no text layer, so no selecting text. No cmaps or wasm decoders over a network that
// doesn't exist, so a rare PDF with unembedded CJK or JPEG 2000 art draws incomplete; Open with covers it.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"

import { el, meta, post, read, run } from "./core"

declare const __PDF_WORKER__: string

const NEAR = "150% 0px"
const MAX_SCALE = 3

class Bridge extends pdfjs.PDFDataRangeTransport {
  requestDataRange(begin: number, end: number) {
    read(begin, end - begin).then(
      (bytes) => this.onDataRange(begin, bytes),
      () => post({ t: "error", message: "Couldn't read this PDF. Check your connection and try again." })
    )
  }
}

run(async () => {
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([__PDF_WORKER__], { type: "text/javascript" })))
  const doc = await pdfjs.getDocument({
    range: new Bridge(meta.size, new Uint8Array(0)),
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
  }).promise

  const pages = el("div", "pages")
  const counter = el("div", "counter")
  document.body.append(pages, counter)
  const width = document.documentElement.clientWidth
  const first = await doc.getPage(1)
  const ratio = first.getViewport({ scale: 1 }).height / first.getViewport({ scale: 1 }).width

  const shown = new Set<number>()
  const setCounter = () => {
    if (shown.size) counter.textContent = `${Math.min(...shown)} / ${doc.numPages}`
  }

  const draw = async (box: HTMLElement, n: number) => {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    box.style.aspectRatio = `${base.width} / ${base.height}`
    // Sharp when pinched in a little; a higher scale runs low-end phones out of canvas memory.
    const scale = Math.min(MAX_SCALE, ((width * devicePixelRatio) / base.width) * 1.5)
    const viewport = page.getViewport({ scale })
    const canvas = el("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    if (box.dataset.on === "1") box.replaceChildren(canvas)
  }

  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const box = e.target as HTMLElement
        const n = Number(box.dataset.n)
        if (e.isIntersecting) {
          box.dataset.on = "1"
          if (!box.firstChild) draw(box, n).catch(() => (box.textContent = `Couldn't draw page ${n}.`))
        } else {
          box.dataset.on = "0"
          box.replaceChildren()
        }
      }
    },
    { rootMargin: NEAR }
  )
  const onScreen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = Number((e.target as HTMLElement).dataset.n)
      if (e.isIntersecting) shown.add(n)
      else shown.delete(n)
    }
    setCounter()
  })

  for (let n = 1; n <= doc.numPages; n++) {
    const box = el("div", "page")
    box.dataset.n = String(n)
    box.style.aspectRatio = `1 / ${ratio}`
    pages.append(box)
    seen.observe(box)
    onScreen.observe(box)
  }
}, "Couldn't read this PDF. It may be damaged or password protected.")
