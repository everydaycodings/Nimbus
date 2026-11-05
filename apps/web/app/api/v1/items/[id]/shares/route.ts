import { z } from "zod"

import { done, json, notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

type Ctx = { params: Promise<{ id: string }> }

// Who has access, the links, and what this server allows. 404 unless the
// member may share the item.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const state = await svc.getShareState(me, (await params).id)
    return state ? Response.json(state) : notFound("That item")
  })

// Shares with a member (`target`: their user id or email), or emails an invite
// to an address with no account yet.
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ target: z.string().min(1), role: z.enum(["viewer", "editor"]) })
    )
    if (b instanceof Response) return b
    return done(await svc.shareWith(me, (await params).id, b.target, b.role))
  })

// Owner only: allow people with access to share it further.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ allowReshare: z.boolean() }))
    if (b instanceof Response) return b
    return done(await svc.setAllowReshare(me, (await params).id, b.allowReshare))
  })
