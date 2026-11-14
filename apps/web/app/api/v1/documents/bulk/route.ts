import { done, json } from "@/lib/api"
import { Bulk } from "@/lib/doc-schemas"
import * as svc from "@/lib/services/documents"

// Set type and/or sender on several documents, and/or confirm them. Mine only.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(
      req,
      Bulk
    )
    if (b instanceof Response) return b
    return done(await svc.bulk(me, b))
  })
