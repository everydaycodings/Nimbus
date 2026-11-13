import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

const Body = z.object({
  parentId: uuid.nullable(),
  purpose: z.literal("camera").optional(),
  entries: z
    .array(
      z.object({
        path: z.string(),
        size: z.number().int().min(0),
        dir: z.boolean().optional(),
      })
    )
    .max(10_000),
})

// Step 1 of an upload. Answers 200 with { token, conflicts, rejected } or an
// `error` string (not enough space, folder gone, too many items): that is a
// 200 with `error`, because the plan itself is the result. See the README.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    return Response.json(await svc.planUpload(me, b.parentId, b.entries, b.purpose))
  })
