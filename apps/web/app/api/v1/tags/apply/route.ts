import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Puts a tag on items, or takes it off (on: false). Items you can't reach are skipped.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ ids: z.array(uuid).max(1000), tagId: uuid, on: z.boolean() })
    )
    if (b instanceof Response) return b
    await svc.tagItems(me, b.ids, b.tagId, b.on)
    return Response.json({})
  })
