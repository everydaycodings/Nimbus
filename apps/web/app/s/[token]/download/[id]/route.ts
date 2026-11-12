import { linkNode, logLinkEvent, openLink } from "@/lib/links"
import { parseQuality } from "@/lib/playback-rules"
import { streamUrl } from "@/lib/video-copies"

const notFound = () => new Response("Not found", { status: 404 })

// A file from a public link, when the link allows downloads. ?quality=480|720: a
// video's data-saver copy, under the same link rules.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  const link = await openLink(token)
  if (!link?.allowView || !link.allowDownload) return notFound()
  const node = await linkNode(link, id)
  if (node?.kind !== "file" || !node.key) return notFound()
  await logLinkEvent(link.id, "download", node.name)
  return Response.redirect(await streamUrl({ key: node.key, name: node.name }, parseQuality(new URL(req.url).searchParams.get("quality"))), 302)
}
