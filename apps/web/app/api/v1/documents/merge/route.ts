import { z } from "zod"

import { done, json, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Images and PDFs, in the order given, into one new PDF in Documents/<year>.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(100), name: z.string().max(150).optional() }))
    if (b instanceof Response) return b
    return done(await svc.mergePdf(me, b.ids, b.name))
  })
