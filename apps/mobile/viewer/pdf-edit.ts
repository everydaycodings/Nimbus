// The PDF editor's page: the shared editor (packages/shared/pdf-editor.ts) running on the file's bytes, driven by the
// app's native toolbar over the bridge. Messages in (window.__cmd) and out (post) are described in src/lib/pdf-edit-rules.ts.
// ponytail: no cmaps or wasm decoders over a network that doesn't exist, so a rare PDF with unembedded CJK or
// JPEG 2000 art draws incomplete here; the marks are still written correctly.
import { PdfEditor, type EditorState } from "@nimbus/shared/pdf-editor"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"

import { el, meta, post, read, run } from "./core"

declare const __PDF_WORKER__: string
declare global {
  interface Window {
    __cmd(c: Record<string, unknown>): void
  }
}

// ~768 KB of file per message, a multiple of 3 so each piece is whole base64 on its own.
const PART = 3 * 256 * 1024

const b64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

run(async () => {
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([__PDF_WORKER__], { type: "text/javascript" })))
  const host = el("div", "pdfedit")
  document.body.append(host)

  let editor: PdfEditor
  try {
    const data = await read(0, meta.size)
    editor = await PdfEditor.open({
      container: host,
      pdfjs: pdfjs as never,
      data,
      author: (meta as { author?: string }).author,
      docOptions: { useSystemFonts: true },
      onChange: (s: EditorState) => post({ t: "state", s }),
    })
  } catch (e) {
    const encrypted = /encrypt|password/i.test(String((e as Error)?.message ?? e))
    post({
      t: "error",
      message: encrypted ? "This PDF is password-protected, so it can't be edited here." : "Couldn't open this PDF for editing.",
      detail: String(e),
    })
    return
  }

  async function save(id: number) {
    try {
      const bytes = await editor.save()
      const n = Math.ceil(bytes.length / PART)
      for (let i = 0; i < n; i++) post({ t: "part", id, i, b64: b64(bytes.subarray(i * PART, (i + 1) * PART)) })
      post({ t: "saved", id, parts: n, size: bytes.length })
    } catch (e) {
      post({ t: "saveError", id, detail: String(e) })
    }
  }

  window.__cmd = (c) => {
    switch (c.c) {
      case "tool":
        return editor.setTool(c.v as never)
      case "color":
        return editor.setColor(String(c.v))
      case "width":
        return editor.setWidth(Number(c.v))
      case "undo":
        return editor.undo()
      case "redo":
        return editor.redo()
      case "delete":
        return editor.deleteSelected()
      case "stamp":
        return editor.setStamp(unb64(String(c.b64)))
      case "save":
        return void save(Number(c.id))
    }
  }
}, "Couldn't open this PDF for editing.")
