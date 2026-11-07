import { filesOf, openTransfer } from "@/lib/transfer-links"
import { getStream, thumbKey } from "@/lib/s3"

const notFound = () => new Response("Not found", { status: 404 })

// Thumbnails on a transfer's page. The URL carries the revision (?r=).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  const t = await openTransfer(token)
  if (!t) return notFound()
  const file = (await filesOf(t.id)).find((f) => f.id === id)
  if (!file?.thumb) return notFound()
  try {
    return new Response(await getStream(thumbKey(file.s3Key)), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch {
    return notFound()
  }
}
