import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Deletes trashed items you own, for good.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(1000) }))
    if (b instanceof Response) return b
    await svc.deleteForever(me, b.ids)
    return Response.json({})
  })
