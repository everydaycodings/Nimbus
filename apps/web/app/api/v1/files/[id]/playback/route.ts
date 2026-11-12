import { notFound, withMember } from "@/lib/api"
import { playbackInfo } from "@/lib/video-copies"

// What the player can offer for a file: data-saver copies (with their state), whether
// the admin allows more, and what Cast would send. 404 if I can't open it.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const r = await playbackInfo(me, (await params).id, new URL(req.url).searchParams.get("v"))
    return r ? Response.json(r) : notFound("That file")
  })
