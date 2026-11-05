import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// "Add shortcut to My files" for something shared with me.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ nodeId: uuid }))
    if (b instanceof Response) return b
    return done(await svc.addShortcut(me, b.nodeId))
  })
