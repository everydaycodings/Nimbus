import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// mkdir -p for each path, relative to parentId; existing folders are reused.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ parentId: uuid.nullable(), paths: z.array(z.string()).max(10_000) })
    )
    if (b instanceof Response) return b
    return done(await svc.createFolders(me, b.parentId, b.paths))
  })
