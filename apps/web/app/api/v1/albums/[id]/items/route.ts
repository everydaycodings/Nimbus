import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { addItems, removeItems } from "@/lib/services/albums"

type Ctx = { params: Promise<{ id: string }> }

const body = z.object({ nodeIds: z.array(uuid).min(1).max(1000) })

// Add my own photos (owner and contributors).
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await addItems(me, (await params).id, b.nodeIds))
  })

// Take photos out: the owner any, a contributor what they added.
export const DELETE = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await removeItems(me, (await params).id, b.nodeIds))
  })
