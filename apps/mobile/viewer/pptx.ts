import { readPptx } from "../../web/lib/pptx"
import { el, meta, read, run } from "./core"

// The deck as an outline, one card per slide, as on the web.
run(async () => {
  const slides = await readPptx(await read(0, meta.size))
  if (!slides.length) throw new Error("no slides")
  const list = el("ol", "slides")
  slides.forEach((slide, i) => {
    const card = el("li", "slide")
    card.append(el("div", "n", `${i + 1} of ${slides.length}`), el("h2", slide.title ? "" : "none", slide.title || "Untitled slide"))
    if (slide.paragraphs.length) {
      const ul = el("ul")
      for (const p of slide.paragraphs) ul.append(el("li", undefined, p))
      card.append(ul)
    }
    for (const image of slide.images) {
      const img = el("img")
      img.alt = image.name
      img.loading = "lazy"
      image.blob().then((b) => (img.src = URL.createObjectURL(b)), () => img.remove())
      card.append(img)
    }
    list.append(card)
  })
  document.body.append(list)
}, "Couldn't read this presentation. It may be damaged.")
