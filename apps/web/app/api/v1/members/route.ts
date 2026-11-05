import { z } from "zod"

import { query, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

// Active members matching ?q= (name or email, 2+ characters), for adding people.
export const GET = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, z.object({ q: z.string().default("") }))
    if (q instanceof Response) return q
    return Response.json({ members: await svc.findMembers(me, q.q) })
  })
