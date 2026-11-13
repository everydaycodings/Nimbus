import { z } from "zod"

import { done, json, notFound, query, withMember } from "@/lib/api"
import { personPhotos, updatePerson } from "@/lib/services/people"

type Ctx = { params: Promise<{ id: string }> }
const q = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().max(100).optional(),
})
const patch = z.object({ name: z.string().max(80).nullable().optional(), hidden: z.boolean().optional(), memories: z.boolean().optional() })

// Their photos, like GET /photos, plus `person` (PersonResponse).
export const GET = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    const r = await personPhotos(me, (await params).id, p.limit, p.cursor)
    return r ? Response.json(r) : notFound("That person")
  })

// Rename (an empty name clears it), hide, or turn their memory cards off. Returns { person }.
export const PATCH = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, patch)
    if (b instanceof Response) return b
    return done(await updatePerson(me, (await params).id, b))
  })
