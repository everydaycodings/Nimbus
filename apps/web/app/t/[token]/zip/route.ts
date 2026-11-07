import { downloadZip, predictLength } from "client-zip"

import { zipName } from "@/lib/file-rules"
import { getStream } from "@/lib/s3"
import {
  countDownload,
  filesOf,
  openTransfer,
  visitCookie,
} from "@/lib/transfer-links"
import { contentDisposition } from "@/lib/upload-rules"

export const runtime = "nodejs"

// Download all: every file of the transfer in one zip, streamed like /s/<token>/zip.
// It counts as one download.
// ponytail: no in-browser fallback on Vercel; add one if transfers there need zips.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  if (process.env.VERCEL)
    return new Response("Zips aren't available here", { status: 501 })
  const { token } = await params
  const t = await openTransfer(token)
  if (!t) return new Response("Not found", { status: 404 })
  const files = await filesOf(t.id)
  if (!files.length) return new Response("Nothing to download", { status: 404 })
  const name = zipName(
    (t.title ?? "transfer").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "transfer"
  )
  if (!(await countDownload(t, name))) return new Response("Closed", { status: 410 })

  const meta = files.map((f) => ({ name: f.name, size: f.size }))
  async function* entries() {
    for (const f of files)
      yield {
        name: f.name,
        input: await getStream(f.s3Key),
        size: f.size,
        lastModified: f.createdAt,
      }
  }
  const zip = downloadZip(entries(), { length: predictLength(meta) })
  const headers = new Headers(zip.headers)
  headers.set("Content-Type", "application/zip")
  headers.set("Content-Disposition", contentDisposition(name))
  headers.append("Set-Cookie", visitCookie(t))
  return new Response(zip.body, { headers })
}
