import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Moves items to the trash. Editors' trash lands in the owner's trash. Undo with POST /items/restore.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(1000) }))
    if (b instanceof Response) return b
    return done(await svc.trashItems(me, b.ids))
  })
