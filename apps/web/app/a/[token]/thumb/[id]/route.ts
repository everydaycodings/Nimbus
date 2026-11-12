import { limitIp } from "@/lib/api"
import { albumNode, openAlbumLink } from "@/lib/album-links"
import { getStream, thumbKey } from "@/lib/s3"

const notFound = () => new Response("Not found", { status: 404 })

// Thumbnails on a public album page. The URL carries the revision (?r=).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const limited = await limitIp("album")
  if (limited) return limited
  const { token, id } = await params
  const link = await openAlbumLink(token)
  if (!link) return notFound()
  const node = await albumNode(link, id)
  if (!node?.key) return notFound()
  try {
    return new Response(await getStream(thumbKey(node.key)), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch {
    return notFound()
  }
}
