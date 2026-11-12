import { notFound, withMember } from "@/lib/api"
import { subtitleTracks } from "@/lib/subtitles"

// A video's subtitle tracks: .srt/.vtt files beside it with the same name, and text
// tracks inside it. Fetch one from /subtitles/{track}. 404 if it isn't a video I can open.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const tracks = await subtitleTracks(me, (await params).id, new URL(req.url).searchParams.get("v"))
    return tracks ? Response.json({ tracks }) : notFound("That video")
  })
