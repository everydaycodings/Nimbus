import { z } from "zod"

import { query } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Amounts per month or year, by sender or type, per currency (my documents, not dismissed).
export const GET = (req: Request) =>
  svc.withDocs(async (me) => {
    const q = query(
      req,
      z.object({
        by: z.enum(["sender", "type"]).default("sender"),
        period: z.enum(["month", "year"]).default("month"),
        year: z.coerce.number().int().min(1900).max(2200).optional(),
      })
    )
    if (q instanceof Response) return q
    return Response.json({ rows: await svc.totals(me, q) })
  })
