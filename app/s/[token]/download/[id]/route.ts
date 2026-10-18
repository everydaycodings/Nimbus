import { linkNode, logLinkEvent, openLink } from "@/lib/links"
import { presignGet } from "@/lib/s3"

const notFound = () => new Response("Not found", { status: 404 })

// A file from a public link, when the link allows downloads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  const link = await openLink(token)
  if (!link?.allowView || !link.allowDownload) return notFound()
  const node = await linkNode(link, id)
  if (node?.kind !== "file" || !node.key) return notFound()
  await logLinkEvent(link.id, "download", node.name)
  return Response.redirect(await presignGet(node.key, node.name), 302)
}
