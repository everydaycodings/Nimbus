import { z } from "zod"

import { done, json, query, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((d) => { const t = Date.parse(d + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }, "Not a real date.")
const List = z.object({
  q: z.string().max(200).optional(),
  type: uuid.optional(),
  sender: uuid.optional(),
  status: z.enum(["review", "confirmed", "dismissed"]).optional(),
  from: day.optional(),
  to: day.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  currency: z.string().length(3).optional(),
  expiring: z.enum(["soon", "expired", "any"]).optional(),
  missing: z.string().max(80).optional(),
  shared: z.enum(["0", "1"]).optional(),
  sort: z.enum(["date", "name", "amount", "expires", "added"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.coerce.number().int().min(0).default(0),
})

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
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(500) }))
    if (b instanceof Response) return b
    return done(await svc.markDocuments(me, b.ids))
  })
