import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { notPerson } from "@/lib/services/people"

const body = z.object({ faceIds: z.array(uuid).min(1).max(500) })

// "Not this person": the faces leave them and never rejoin. Returns { removed }.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await notPerson(me, (await params).id, b.faceIds))
  })
