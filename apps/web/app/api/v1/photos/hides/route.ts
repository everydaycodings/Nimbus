import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import { addHide, listHides } from "@/lib/services/photos"

const body = z.object({
  kind: z.enum(["photo", "day", "folder"]),
  nodeId: z.string().optional(),
  day: z.string().optional(),
})

export const GET = () =>
  withMember(async (me) => Response.json({ hides: await listHides(me) }))

// Hide a photo, a day ("MM-DD") or a folder from memories.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await addHide(me, b))
  })
