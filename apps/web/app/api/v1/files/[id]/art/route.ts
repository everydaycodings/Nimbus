import { fail, notFound } from "@/lib/api"
import { castArt } from "@/lib/cast-art"
import { openableFile } from "@/lib/files"
import { readToken } from "@/lib/upload-rules"

// The cover art (audio) or poster thumbnail (video) behind a cast URL's `artUrl`.
// Only with its signed ?t= token, CORS open so a Chromecast can fetch it.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const t = readToken<{ exp: number; u: string; id: string }>("art", new URL(req.url).searchParams.get("t"))
  if (!t || t.exp < Date.now() || t.id !== id)
    return fail(401, "bad-token", "That picture link has expired.")
  const file = await openableFile(t.u, id)
  const art = file && (await castArt(file))
  if (!art) return notFound("That picture")
  return new Response(art.body, {
    headers: {
      "Content-Type": art.type,
      "Cache-Control": "private, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
