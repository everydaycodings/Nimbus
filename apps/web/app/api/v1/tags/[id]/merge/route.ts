import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/files"

// Moves every item tagged {id} onto `into`, then deletes {id}.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ into: uuid }))
    if (b instanceof Response) return b
    return done(await svc.mergeTags(me, (await params).id, b.into))
  })
