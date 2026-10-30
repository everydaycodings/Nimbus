import { atLeast } from "@/lib/access"
import { db } from "@/lib/db"
import { openableFile } from "@/lib/files"
import { deleteObject, getStream, thumbKey } from "@/lib/s3"
import { memberOrNull } from "@/lib/session"
import { saveThumb, setThumb } from "@/lib/thumb-store"

type Ctx = { params: Promise<{ id: string }> }

const notFound = () => new Response("Not found", { status: 404 })

async function lookup(req: Request, { params }: Ctx) {
  const me = await memberOrNull()
  if (!me) return null
  const v = new URL(req.url).searchParams.get("v")
  return openableFile(me.id, (await params).id, v)
}

// The thumbnail of ?v=. Its URL carries the revision (?r=), so it caches forever.
export async function GET(req: Request, ctx: Ctx) {
  const file = await lookup(req, ctx)
  if (!file) return notFound()
  try {
    return new Response(await getStream(thumbKey(file.key)), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch {
    return notFound()
  }
}

const MAX = 512 * 1024

// The browser posts a thumbnail it made or an editor picked, or an empty body
// when it couldn't make one, so nobody tries again. Answers the new revision.
export async function POST(req: Request, ctx: Ctx) {
  const file = await lookup(req, ctx)
  if (!file || !atLeast(file.role, "editor")) return notFound()
  const body = new Uint8Array(await req.arrayBuffer())
  if (body.length > MAX)
    return new Response("Thumbnail too big", { status: 413 })
  const webp =
    body.length > 12 &&
    String.fromCharCode(...body.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...body.slice(8, 12)) === "WEBP"
  if (body.length && !webp)
    return new Response("Not a WebP image", { status: 415 })
  const thumb = await saveThumb(db.$client, file.key, webp ? body : null)
  return Response.json({ thumb })
}

// Back to automatic: the next tile that shows it draws a fresh one.
export async function DELETE(req: Request, ctx: Ctx) {
  const file = await lookup(req, ctx)
  if (!file || !atLeast(file.role, "editor")) return notFound()
  await deleteObject(thumbKey(file.key))
  await setThumb(db.$client, file.key, null)
  return new Response(null, { status: 204 })
}
