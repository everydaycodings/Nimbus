import { z } from "zod"

import { done, json } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Documents/<year of `date`, else this year>, made when missing. Upload new documents into the folder it returns.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    if (b instanceof Response) return b
    return done(await svc.uploadTarget(me, b.date))
  })
