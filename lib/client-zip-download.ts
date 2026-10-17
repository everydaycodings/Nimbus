import { downloadZip } from "client-zip"

import { zipManifest } from "@/app/(app)/upload-actions"

const BLOB_WARN = 2 * 1024 ** 3

type SavePicker = (opts: {
  suggestedName: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>

// Zips in the browser for hosts that can't stream a zip (Vercel). Chromium
// streams straight to disk; other browsers build a Blob in memory first.
// Resolves false when the person backs out (save picker or size warning).
export async function clientZipDownload(
  ids: string[],
  suggestedName: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker
  // The picker needs the click's user activation, so it opens before any await.
  let file: Awaited<ReturnType<SavePicker>> | null = null
  if (picker) {
    try {
      file = await picker({
        suggestedName,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      })
    } catch (e) {
      if ((e as Error).name === "AbortError") return false
      throw e
    }
  }

  const m = await zipManifest(ids)
  const total = m.entries.reduce((n, e) => n + e.size, 0)
  if (
    !file &&
    total > BLOB_WARN &&
    !window.confirm(
      "This zip is over 2 GB. This browser builds it in memory first, which can be slow or fail. Continue?"
    )
  )
    return false

  async function* inputs() {
    for (const dir of m.dirs) yield { name: `${dir}/` }
    for (const e of m.entries) {
      const res = await fetch(e.url, { signal })
      if (!res.ok) throw new Error(`Couldn't fetch ${e.path}`)
      yield {
        name: e.path,
        input: res,
        size: e.size,
        lastModified: new Date(e.modified),
      }
    }
  }

  let done = 0
  const body = downloadZip(inputs()).body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        done += chunk.byteLength
        onProgress(Math.min(done, total), total)
        out.enqueue(chunk)
      },
    })
  )

  if (file) {
    await body.pipeTo(await file.createWritable(), { signal })
    return true
  }
  const blob = await new Response(body).blob()
  if (signal.aborted) return false
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = /\.zip$/i.test(m.name) ? m.name : `${m.name}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  return true
}
