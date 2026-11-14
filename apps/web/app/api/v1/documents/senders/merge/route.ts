import { z } from "zod"

import { done, json, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// `from` becomes `into`: its documents move and its name and patterns are kept as patterns.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ from: uuid, into: uuid }))
    if (b instanceof Response) return b
    return done(await svc.mergeSenders(me, b.from, b.into))
  })
