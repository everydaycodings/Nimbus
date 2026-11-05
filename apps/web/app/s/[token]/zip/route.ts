import { downloadZip, predictLength } from "client-zip"

import { linkNode, logLinkEvent, openLink } from "@/lib/links"
import { getStream } from "@/lib/s3"
import { contentDisposition } from "@/lib/upload-rules"
import { zipTree } from "@/lib/uploads"

export const runtime = "nodejs"

// A zip of items inside a public link, streamed like /api/zip.
// ponytail: no in-browser fallback for links on Vercel; add one if links there need zips.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  if (process.env.VERCEL)
    return new Response("Zips aren't available here", { status: 501 })
  const { token } = await params
  const link = await openLink(token)
  if (!link?.allowView || !link.allowDownload)
    return new Response("Not found", { status: 404 })

  const form = await req.formData()
  const asked = form.getAll("ids").map(String).slice(0, 1000)
  const ids: string[] = []
  for (const id of asked) if (await linkNode(link, id)) ids.push(id)
  const tree = await zipTree(ids)
  if (!tree) return new Response("Nothing to download", { status: 404 })
  await logLinkEvent(link.id, "download", tree.name)

  const meta = [
    ...tree.dirs.map((name) => ({ name })),
    ...tree.files.map((f) => ({ name: f.path, size: f.size })),
  ]
  async function* entries() {
    for (const name of tree!.dirs) yield { name }
    for (const f of tree!.files)
      yield {
        name: f.path,
        input: await getStream(f.key),
        size: f.size,
        lastModified: f.modified,
      }
  }
  const zip = downloadZip(entries(), { length: predictLength(meta) })
  const headers = new Headers(zip.headers)
  headers.set("Content-Type", "application/zip")
  headers.set("Content-Disposition", contentDisposition(tree.name))
  return new Response(zip.body, { headers })
}
