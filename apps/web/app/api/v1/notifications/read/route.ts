import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/notifications"

// Marks notifications read: the listed ids (up to 100), or all when `ids` is omitted.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).max(100).optional() }))
    if (b instanceof Response) return b
    await svc.markRead(me, b.ids)
    return Response.json({})
  })
