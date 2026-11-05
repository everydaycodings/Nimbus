import { linkNode, openLink } from "@/lib/links"
import { getStream, thumbKey } from "@/lib/s3"

const notFound = () => new Response("Not found", { status: 404 })

// Thumbnails on a public link's page. The URL carries the revision (?r=).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  const link = await openLink(token)
  if (!link?.allowView) return notFound()
  const node = await linkNode(link, id)
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
