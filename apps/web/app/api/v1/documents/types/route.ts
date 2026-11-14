import { z } from "zod"

import { done, json } from "@/lib/api"
import * as svc from "@/lib/services/documents"

const TypeBody = z.object({
  name: z.string().trim().min(1).max(60),
  remindDays: z.number().int().min(0).max(3650).nullable(),
})

// Preset types and mine.
export const GET = () => svc.withDocs(async (me) => Response.json({ types: await svc.listTypes(me) }))

export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, TypeBody)
    if (b instanceof Response) return b
    return done(await svc.saveType(me, b))
  })
