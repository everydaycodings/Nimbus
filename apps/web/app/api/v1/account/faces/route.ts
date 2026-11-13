import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { setFacesOn } from "@/lib/services/people"

const body = z.object({ on: z.boolean() })

// Face grouping for my account. Off deletes my faces and people. Returns { on }.
export const PUT = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await setFacesOn(me, b.on))
  })
