import { notFound, withMember } from "@/lib/api"
import { parseQuality } from "@/lib/playback-rules"
import * as svc from "@/lib/services/uploads"
import { readyCopyHeights } from "@/lib/video-copies"

// A short-lived direct storage URL for viewing the file. ?v= picks an older
// version (owners and editors); ?open=1 counts as opened (Recent); ?quality=480|720
// gives a video's data-saver copy when it has one, else the original. `copies`
// lists the sizes ready for the current version.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const sp = new URL(req.url).searchParams
    const id = (await params).id
    const url = await svc.previewUrl(
      me,
      id,
      sp.get("v"),
      sp.get("open") === "1",
      parseQuality(sp.get("quality"))
    )
    return url
      ? Response.json({ url, copies: await readyCopyHeights(id) })
      : notFound("That file")
  })
