import { z } from "zod"

import { done, json } from "@/lib/api"
import * as svc from "@/lib/services/documents"

export const GET = () => svc.withDocs(async (me) => Response.json({ senders: await svc.listSenders(me) }))

// A sender by name; answers the existing one when the name is taken.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ name: z.string().trim().min(1).max(100) }))
    if (b instanceof Response) return b
    return done(await svc.createSender(me, b.name))
  })
