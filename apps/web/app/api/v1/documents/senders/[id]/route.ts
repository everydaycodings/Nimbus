import { z } from "zod"

import { done, json, notFound, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

type Ctx = { params: Promise<{ id: string }> }

// Rename and/or replace the match patterns. A name another sender has is refused: merge instead.
export const PATCH = (req: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That sender")
    const b = await json(
      req,
      z.object({ name: z.string().trim().min(1).max(100).optional(), patterns: z.array(z.string().max(100)).max(50).optional() })
    )
    if (b instanceof Response) return b
    return done(await svc.updateSender(me, id, b))
  })

// Its documents keep their other fields and lose the sender.
export const DELETE = (_: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That sender")
    return done(await svc.deleteSender(me, id))
  })
