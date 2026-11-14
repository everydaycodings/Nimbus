import { z } from "zod"

import { done, json, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

// Set type and/or sender on several documents, and/or confirm them. Mine only.
export const POST = (req: Request) =>
  svc.withDocs(async (me) => {
    const b = await json(
      req,
      z.object({
        ids: z.array(uuid).min(1).max(500),
        typeId: uuid.nullable().optional(),
        senderId: uuid.nullable().optional(),
        confirm: z.boolean().optional(),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.bulk(me, b))
  })
