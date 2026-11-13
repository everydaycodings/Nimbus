import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { moveFaces } from "@/lib/services/people"

const body = z.object({ faceIds: z.array(uuid).min(1).max(500), toId: uuid })

// Moves the chosen faces to another person. Returns { person } (the target).
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await moveFaces(me, (await params).id, b.faceIds, b.toId))
  })
