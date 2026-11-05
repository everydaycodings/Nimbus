import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// New folder in My files (parentId null) or inside a folder you may edit.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ parentId: uuid.nullable(), name: z.string() })
    )
    if (b instanceof Response) return b
    const r = await svc.createFolder(me, b.parentId, b.name)
    return done(r)
  })
