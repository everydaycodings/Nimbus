import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Moves items into a folder (null: My files). Only within one owner's tree.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ ids: z.array(uuid).min(1).max(1000), parentId: uuid.nullable() })
    )
    if (b instanceof Response) return b
    return done(await svc.moveItems(me, b.ids, b.parentId))
  })
