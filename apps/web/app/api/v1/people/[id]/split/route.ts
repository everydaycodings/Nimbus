import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { moveFaces } from "@/lib/services/people"

const body = z.object({ faceIds: z.array(uuid).min(1).max(500) })

// Moves the chosen faces to a new, unnamed person. Returns { person } (the new one).
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await moveFaces(me, (await params).id, b.faceIds, null))
  })
