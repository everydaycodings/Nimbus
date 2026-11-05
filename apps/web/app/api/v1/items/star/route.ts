import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Stars or unstars items. Items you can't see are skipped when starring.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ ids: z.array(uuid).min(1).max(1000), starred: z.boolean() })
    )
    if (b instanceof Response) return b
    await svc.setStarred(me, b.ids, b.starred)
    return Response.json({})
  })
