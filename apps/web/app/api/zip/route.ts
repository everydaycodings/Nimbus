import { downloadZip, predictLength } from "client-zip"

import { viewable } from "@/lib/access"
import { UUID } from "@/lib/files"
import { getStream } from "@/lib/s3"
import { getSession } from "@/lib/session"
import { contentDisposition } from "@/lib/upload-rules"
import { zipTree } from "@/lib/uploads"

export const runtime = "nodejs"

// Streams a store-only ZIP64 of items the user can see, pulling one S3 object at a
// time, so memory stays flat however big it gets. Serverless hosts cut long
// responses off, so there the browser builds the zip itself (zipManifest).
export async function POST(req: Request) {
  if (process.env.VERCEL)
    return new Response("Zip in the browser instead", { status: 501 })
  const session = await getSession()
  if (
    !session ||
    session.user.status !== "active" ||
    session.user.passwordTemporary
  )
    return new Response("Sign in first", { status: 401 })

  const form = await req.formData()
  const ids = form
    .getAll("ids")
    .map(String)
    .filter((id) => UUID.test(id))
    .slice(0, 1000)
  const tree = await zipTree(await viewable(session.user.id, ids))
  if (!tree) return new Response("Nothing to download", { status: 404 })

  // Folders first, then files, in the same order for the length prediction.
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
