import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/comments"

// Adds ({ emoji, on: true }) or removes my reaction; emoji is one of @nimbus/shared/comments REACTIONS.
export const PUT = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ emoji: z.string(), on: z.boolean() }))
    if (b instanceof Response) return b
    return done(await svc.react(me, (await params).id, b.emoji, b.on))
  })
