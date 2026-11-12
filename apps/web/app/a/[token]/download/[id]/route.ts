import { limitIp } from "@/lib/api"
import { albumNode, openAlbumLink } from "@/lib/album-links"
import { parseQuality } from "@/lib/playback-rules"
import { streamUrl } from "@/lib/video-copies"

const notFound = () => new Response("Not found", { status: 404 })

// A photo or video from a public album link, when the link allows downloads. ?quality=480|720: a
// video's data-saver copy.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const limited = await limitIp("album")
  if (limited) return limited
  const { token, id } = await params
  const link = await openAlbumLink(token)
  if (!link?.allowDownload) return notFound()
  const node = await albumNode(link, id)
  if (!node?.key) return notFound()
  return Response.redirect(await streamUrl({ key: node.key, name: node.name }, parseQuality(new URL(req.url).searchParams.get("quality"))), 302)
}
