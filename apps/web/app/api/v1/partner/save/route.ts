import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { saveCopy } from "@/lib/services/partners"

const body = z.object({ nodeIds: z.array(uuid).min(1).max(200) })

// Save to my library: copies into Photos/From <name>, counted against my storage.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await saveCopy(me, b.nodeIds))
  })
