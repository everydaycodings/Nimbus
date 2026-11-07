import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transfers"

// Permission to upload one device file into a draft transfer: tus metadata
// `token` (and `path`, `filetype`), then POST /uploads/finish.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ name: z.string().max(255), size: z.number().int().min(0) })
    )
    if (b instanceof Response) return b
    return done(await svc.addFileToken(me, (await params).id, b.name, b.size))
  })
