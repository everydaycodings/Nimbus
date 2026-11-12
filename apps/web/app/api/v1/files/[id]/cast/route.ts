import { z } from "zod"

import { done, query, withMember } from "@/lib/api"
import { getSettings } from "@/lib/signup"
import { castUrl } from "@/lib/video-copies"

const q = z.object({
  duration: z.coerce.number().min(0).optional(),
  v: z.string().optional(),
})

// The URL to hand a Chromecast: valid for the media's length (?duration=, seconds) plus
// an hour, so call again to refresh it. The original when a Chromecast plays it, else
// the 720p copy. 409 "no-copy" (with canMakeCopy) when it needs a copy that isn't ready.
// My files and Shared with me only: vault files and public links aren't castable.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    const r = await castUrl(me, (await params).id, p.duration ?? null, p.v)
    if (r.error !== "no-copy") return done(r)
    return Response.json(
      {
        error: "no-copy",
        message: "This video can't be cast yet.",
        canMakeCopy: (await getSettings()).videoCopies,
      },
      { status: 409 }
    )
  })
