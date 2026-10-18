// Fills the search index from the browser: right after an upload from the local
// copy, and for older files when someone who can edit them opens their folder.
// One file at a time, when the page is idle.
import { ocrLangs, saveContent } from "@/app/(app)/search-actions"
import { previewUrl } from "@/app/(app)/upload-actions"
import { extractText, MAX_BODY, sourceOf, tooBig } from "@/lib/extract"
import { previewKind } from "@/lib/file-rules"
import { readRange, type ThumbFile } from "@/lib/thumbs"

let queue: Promise<unknown> = Promise.resolve()
const started = new Set<string>()
let langs: Promise<string> | undefined

const idle = () =>
  new Promise<void>((go) =>
    "requestIdleCallback" in window
      ? requestIdleCallback(() => go(), { timeout: 10_000 })
      : setTimeout(go, 500)
  )

export function ensureIndexed(f: ThumbFile, file?: Blob) {
  const v = f.version
  const source = sourceOf(previewKind(f.mime, f.name))
  if (!v || !source || tooBig(source, f.size) || started.has(v)) return
  // Reading text in images needs a few hundred MB.
  const memory = (navigator as { deviceMemory?: number }).deviceMemory
  if (source === "ocr" && memory !== undefined && memory < 4) return
  started.add(v)
  // Text files only need their start.
  const end = Math.min(f.size, source === "text" ? MAX_BODY * 4 : f.size)
  queue = queue
    .then(async () => {
      await idle()
      let bytes: Uint8Array
      if (!end) bytes = new Uint8Array()
      else if (file)
        bytes = new Uint8Array(await file.slice(0, end).arrayBuffer())
      else {
        const url = await previewUrl(f.id, v)
        if (!url) return
        bytes = await readRange(url, 0, end)
      }
      // A file that can't be read as its kind has no text to find.
      const body = await extractText(
        bytes,
        source,
        source === "ocr" ? await (langs ??= ocrLangs()) : undefined
      ).catch(() => "")
      await saveContent(f.id, v, body, source)
    })
    // Network trouble: tried again on the next page load, not every re-render.
    .catch(() => {})
}
