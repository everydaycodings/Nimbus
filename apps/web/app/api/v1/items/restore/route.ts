import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Brings trashed items back. Items whose name is taken in their folder now stay in the trash and come back in the error message.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(1000) }))
    if (b instanceof Response) return b
    return done(await svc.restoreItems(me, b.ids))
  })
