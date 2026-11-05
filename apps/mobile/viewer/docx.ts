import { renderAsync } from "docx-preview"

import { el, meta, read, run } from "./core"

run(async () => {
  const box = el("div")
  document.body.append(box)
  await renderAsync(new Blob([(await read(0, meta.size)) as BlobPart]), box, undefined, {
    renderAltChunks: false,
    ignoreLastRenderedPageBreak: true,
    ignoreWidth: true,
    ignoreHeight: true,
    breakPages: false,
  })
  // Links in a document can say anything; keep the ones that go somewhere real.
  for (const a of box.querySelectorAll("a[href]"))
    if (!/^(https?:|mailto:|#)/i.test(a.getAttribute("href")!)) a.removeAttribute("href")
}, "Couldn't read this document. It may be damaged.")
