import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

const Body = z.object({
  items: z
    .array(
      z.object({
        sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        name: z.string().max(255).optional(),
        size: z.number().int().min(0).optional(),
        parentId: uuid.nullable().optional(),
      })
    )
    .min(1)
    .max(200),
})

// Do I already have these? One answer per item, in order: the match or null.
// Backup asks before sending.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    return Response.json({ matches: await svc.findExisting(me, b.items) })
  })
