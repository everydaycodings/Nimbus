import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { TAG_COLORS } from "@/lib/db/schema"
import * as svc from "@/lib/services/files"

const Snapshot = z.object({
  tag: z.object({
    id: uuid,
    name: z.string().min(1).max(40),
    color: z.enum(TAG_COLORS),
  }),
  nodeIds: z.array(uuid).max(10_000),
})

// Undo for DELETE /tags/{id}: send back what it returned.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Snapshot)
    if (b instanceof Response) return b
    return done(await svc.restoreTag(me, b))
  })
