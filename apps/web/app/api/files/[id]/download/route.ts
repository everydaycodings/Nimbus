import { markOpened, openableFile } from "@/lib/files"
import { parseQuality } from "@/lib/playback-rules"
import { headSize } from "@/lib/s3"
import { memberOrNull } from "@/lib/session"
import { streamUrl } from "@/lib/video-copies"

const notFound = () => new Response("Not found", { status: 404 })

// 302 to a presigned S3 URL. ?v= picks an older version; ?quality=480|720 the
// data-saver copy of a video, or the original when it has none.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await memberOrNull()
  if (!me) return new Response("Sign in first", { status: 401 })
  const { id } = await params
  const sp = new URL(req.url).searchParams
  const v = sp.get("v")
  const file = await openableFile(me.id, id, v)
  if (!file || (await headSize(file.key)) === null) return notFound()
  await markOpened(me.id, id)
  return Response.redirect(await streamUrl(file, parseQuality(sp.get("quality"))), 302)
}
