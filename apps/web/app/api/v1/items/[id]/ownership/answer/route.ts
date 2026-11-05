import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

// The member offered ownership accepts or declines.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ accept: z.boolean() }))
    if (b instanceof Response) return b
    return done(await svc.answerOwnership(me, (await params).id, b.accept))
  })
