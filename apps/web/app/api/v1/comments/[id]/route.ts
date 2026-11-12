import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/comments"

type Ctx = { params: Promise<{ id: string }> }

const patch = z.object({ body: z.string().optional(), resolved: z.boolean().optional() })

// Edit my comment ({ body }), or resolve / reopen a thread ({ resolved }).
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, patch)
    if (b instanceof Response) return b
    const id = (await params).id
    if (b.resolved !== undefined) return done(await svc.resolveThread(me, id, b.resolved))
    return done(await svc.editComment(me, id, b.body))
  })

// Mine, or anyone's for the file's owner and editors. A first comment with replies becomes a stub.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await svc.deleteComment(me, (await params).id)))
