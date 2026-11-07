import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

// New public link. Returns { id }; read its token and URL parts from the share state.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        name: z.string().optional(),
        password: z.string().optional(),
        request: z.boolean().optional(),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.createLink(me, (await params).id, b))
  })
