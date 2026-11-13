import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { mergePeople } from "@/lib/services/people"

const body = z.object({ intoId: uuid })

// Merges this person into `intoId`. Returns { person } (the one left).
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await mergePeople(me, (await params).id, b.intoId))
  })
