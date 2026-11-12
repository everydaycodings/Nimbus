import { z } from "zod"

import { done, json, notFound, withMember } from "@/lib/api"
import { listShares, shareWith } from "@/lib/services/albums"

type Ctx = { params: Promise<{ id: string }> }

const body = z.object({ userId: z.string(), role: z.enum(["viewer", "contributor"]) })

// Owner only: the people and links.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const r = await listShares(me, (await params).id)
    return r ? Response.json(r) : notFound("That album")
  })

// Share with a member (or change their role).
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await shareWith(me, (await params).id, b.userId, b.role))
  })
