import { downloadZip } from "client-zip"

import { zipManifest } from "@/app/(app)/upload-actions"

const BLOB_WARN = 2 * 1024 ** 3

type SavePicker = (opts: {
  suggestedName: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>

type SaveTarget = Awaited<ReturnType<SavePicker>> | null

// Chromium's save picker, or null where there's none (save through a Blob).
// False when the person cancels. It needs the click's user activation, so call
// it before any await.
export async function pickSaveTarget(
  suggestedName: string,
  types?: Parameters<SavePicker>[0]["types"]
): Promise<SaveTarget | false> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker
  if (!picker) return null
  try {
    return await picker({ suggestedName, types })
  } catch (e) {
    if ((e as Error).name === "AbortError") return false
    throw e
  }
}

// Streams to the picked file, or else builds a Blob and downloads it.
export async function saveStream(
  body: ReadableStream<Uint8Array>,
  file: SaveTarget,
  name: string,
  signal: AbortSignal
) {
  if (file) {
    await body.pipeTo(await file.createWritable(), { signal })
    return true
  }
  const blob = await new Response(body).blob()
  if (signal.aborted) return false
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  return true
}

export type ZipManifest = {
  name: string
  dirs: string[]
  entries: {
    path: string
    size: number
    modified: string
    open: () => Promise<Response | ReadableStream<Uint8Array>>
  }[]
}

// Zips in the browser for hosts that can't stream a zip (Vercel). Chromium
// streams straight to disk; other browsers build a Blob in memory first.
// Resolves false when the person backs out (save picker or size warning).
export function clientZipDownload(
  ids: string[],
  suggestedName: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  return zipDownload(
    async () => {
      const m = await zipManifest(ids)
      return {
        ...m,
        entries: m.entries.map((e) => ({
          ...e,
          async open() {
            const res = await fetch(e.url, { signal })
            if (!res.ok) throw new Error(`Couldn't fetch ${e.path}`)
            return res
          },
        })),
      }
    },
    suggestedName,
    onProgress,
    signal
  )
}

// The same from any list of entries; vaults hand in decrypted streams.
export async function zipDownload(
  load: (signal: AbortSignal) => Promise<ZipManifest>,
  suggestedName: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  const file = await pickSaveTarget(suggestedName, [
    { description: "ZIP archive", accept: { "application/zip": [".zip"] } },
  ])
  if (file === false) return false

  const m = await load(signal)
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
    for (const e of m.entries)
      yield {
        name: e.path,
        input: await e.open(),
        size: e.size,
        lastModified: new Date(e.modified),
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

  const name = /\.zip$/i.test(m.name) ? m.name : `${m.name}.zip`
  return saveStream(body, file, name, signal)
}
