// WOPI GetFile: the bytes Collabora renders.
import { openableFile } from "@/lib/files"
import { readWopi } from "@/lib/office"
import { getStream } from "@/lib/s3"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const t = readWopi(new URL(req.url).searchParams.get("access_token"), id)
  const file = t && (await openableFile(t.u, id, t.v))
  if (!t || !file) return new Response("Not found", { status: 404 })
  return new Response(await getStream(file.key), {
    headers: { "Content-Type": "application/octet-stream" },
  })
}
