import { fail, notFound, withMember } from "@/lib/api"
import { subtitleVtt } from "@/lib/subtitles"
import { readToken } from "@/lib/upload-rules"

type Ctx = { params: Promise<{ id: string; track: string }> }

// One track (id or `url` from /subtitles) as WebVTT. Either signed in, or the signed
// ?t= token the track's `url` carries, which is how a Cast receiver fetches it (CORS open).
export async function GET(req: Request, { params }: Ctx) {
  const { id, track: raw } = await params
  const track = decodeURIComponent(raw)
  const sp = new URL(req.url).searchParams
  const v = sp.get("v")
  const serve = async (userId: string, cors: boolean) => {
    const vtt = await subtitleVtt(userId, id, track, v)
    return vtt
      ? new Response(vtt, {
          headers: {
            "Content-Type": "text/vtt; charset=utf-8",
            "Cache-Control": "private, max-age=3600",
            ...(cors && { "Access-Control-Allow-Origin": "*" }),
          },
        })
      : notFound("That track")
  }
  if (sp.has("t")) {
    const t = readToken<{ exp: number; u: string; id: string; track: string }>("subs", sp.get("t"))
    if (!t || t.exp < Date.now() || t.id !== id || t.track !== track)
      return fail(401, "bad-token", "That subtitle link has expired.")
    return serve(t.u, true)
  }
  return withMember((me) => serve(me.id, false))
}
