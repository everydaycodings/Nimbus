import { limitIp } from "@/lib/api"
import { albumNode, openAlbumLink } from "@/lib/album-links"
import { presignGet } from "@/lib/s3"

const notFound = () => new Response("Not found", { status: 404 })

// A photo from a public album link, when the link allows downloads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const limited = await limitIp("album")
  if (limited) return limited
  const { token, id } = await params
  const link = await openAlbumLink(token)
  if (!link?.allowDownload) return notFound()
  const node = await albumNode(link, id)
  if (!node?.key) return notFound()
  return Response.redirect(await presignGet(node.key, node.name), 302)
}
