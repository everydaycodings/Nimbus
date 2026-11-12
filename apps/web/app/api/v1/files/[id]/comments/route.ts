import { z } from "zod"

import { done, json, notFound, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/comments"

type Ctx = { params: Promise<{ id: string }> }

// A file's threads, oldest first, with the people they name. 404 if I can't open it.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const r = await svc.listComments(me, (await params).id)
    return r ? Response.json(r) : notFound()
  })

const body = z.object({
  body: z.string(),
  parentId: uuid.optional(),
  atSeconds: z.number().int().min(0).optional(),
  page: z.number().int().min(1).optional(),
})

// A new thread, or a reply when parentId is set. Answers { id }.
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await svc.addComment(me, (await params).id, b))
  })
