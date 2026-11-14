import { query } from "@/lib/api"
import { Totals } from "@/lib/doc-schemas"
import * as svc from "@/lib/services/documents"

// Amounts per month or year, by sender or type, per currency (my documents, not dismissed).
export const GET = (req: Request) =>
  svc.withDocs(async (me) => {
    const q = query(
      req,
      Totals
    )
    if (q instanceof Response) return q
    return Response.json({ rows: await svc.totals(me, q) })
  })
