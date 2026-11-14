import { z } from "zod"

import { done, json, query } from "@/lib/api"
import { Ids, List } from "@/lib/doc-schemas"
import * as svc from "@/lib/services/documents"

// Documents with their fields: mine and, read-only, confirmed ones shared with me.
export const GET = (req: Request) =>
  svc.withDocs(async (me) => {
    const q = query(req, List)
    if (q instanceof Response) return q
    return Response.json(await svc.listDocuments(me, q))
  })

// Marks files as documents ("Mark as document", and Undo for "Not a document").
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(req, z.object({ ids: Ids }))
    if (b instanceof Response) return b
    return done(await svc.markDocuments(me, b.ids))
  })
