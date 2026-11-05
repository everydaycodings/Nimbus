import { listResponse, withMember } from "@/lib/api"
import { listShared, listSharedByMe } from "@/lib/files"

// ?by=me lists what I shared; otherwise what was shared with me.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const byMe = new URL(req.url).searchParams.get("by") === "me"
    return listResponse(
      me,
      req,
      byMe ? await listSharedByMe(me.id) : await listShared(me.id)
    )
  })
