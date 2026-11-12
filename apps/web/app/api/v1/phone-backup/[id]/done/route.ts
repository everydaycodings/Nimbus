import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/phone-backup"

// A copy was uploaded: stamps the time, clears the stale alert, trashes copies of that type beyond `keep`.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ type: z.enum(["contacts", "calendar"]), keep: z.number().int().min(1).max(1000).nullable() })
    )
    if (b instanceof Response) return b
    const id = uuid.safeParse((await params).id)
    if (!id.success) return done({ error: "That phone is gone." })
    return done(await svc.finishCopy(me, id.data, b.type, b.keep))
  })
