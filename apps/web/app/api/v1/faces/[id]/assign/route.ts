import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import { assignFace } from "@/lib/services/people"

const body = z.union([z.object({ personId: uuid }), z.object({ name: z.string().max(80) })])

// Puts a face on an existing person ({ personId }) or a new one ({ name }, may be empty). Returns { person }.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    return done(await assignFace(me, (await params).id, b))
  })
